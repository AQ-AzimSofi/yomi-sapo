import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWriteTransaction } from './writeTransaction';

// Runs only against an Aurora DSQL test cluster, as admin in a scratch table it drops afterwards:
// DSQL_TEST_ENDPOINT=<cluster id>.dsql.<region>.on.aws plus AWS credentials the aws CLI can use
// to mint an admin token. Never point it at a cluster that serves the app.
const ENDPOINT = process.env.DSQL_TEST_ENDPOINT ?? '';
const TABLE = `write_transaction_test_${Date.now()}`;
const SLOW_WRITE_SECONDS = 1;
const FAST_WRITE_AFTER_MS = 300;

function regionOf(endpoint: string): string {
  const match = /\.dsql\.([a-z0-9-]+)\.on\.aws$/.exec(endpoint);
  if (!match) throw new Error(`DSQL_TEST_ENDPOINT is not a DSQL endpoint: ${endpoint}`);
  return match[1];
}

function mintAdminToken(endpoint: string): string {
  const args = ['dsql', 'generate-db-connect-admin-auth-token', '--hostname', endpoint, '--region', regionOf(endpoint), '--expires-in', '3600'];
  return execFileSync('aws', args, { encoding: 'utf8' }).trim();
}

// postgres.js asks for the password on each new connection, so a token is minted only when one opens.
function connectAsAdmin(): postgres.Sql {
  return postgres({
    host: ENDPOINT,
    port: 5432,
    database: 'postgres',
    username: 'admin',
    password: () => mintAdminToken(ENDPOINT),
    ssl: 'verify-full',
    max: 1,
    onnotice: () => {},
  });
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// The upsertBookmark statement, held open by pg_sleep so another writer commits to the same row meanwhile.
function slowUpsert(client: postgres.Sql, delaySeconds: number) {
  return client`
    INSERT INTO ${client(TABLE)} (file_name, directory, bookmark_text)
    SELECT 'ほん', 'd', 'slow writer' FROM (SELECT pg_sleep(${delaySeconds})) AS delay
    ON CONFLICT (file_name, directory)
    DO UPDATE SET bookmark_text = EXCLUDED.bookmark_text
  `;
}

describe.skipIf(!ENDPOINT)('runWriteTransaction on Aurora DSQL', () => {
  const fast = connectAsAdmin();
  const slow = connectAsAdmin();

  async function resetRow(): Promise<void> {
    await runWriteTransaction(fast, async (tx) => {
      await tx`DELETE FROM ${tx(TABLE)}`;
    });
    await runWriteTransaction(fast, async (tx) => {
      await tx`INSERT INTO ${tx(TABLE)} (file_name, directory, bookmark_text) VALUES ('ほん', 'd', 'start')`;
    });
  }

  async function overwriteWhileSlowWriteRuns(): Promise<void> {
    await sleep(FAST_WRITE_AFTER_MS);
    await runWriteTransaction(fast, async (tx) => {
      await tx`UPDATE ${tx(TABLE)} SET bookmark_text = 'fast writer' WHERE file_name = 'ほん' AND directory = 'd'`;
    });
  }

  async function storedText(): Promise<string> {
    const [row] = await fast<{ bookmark_text: string }[]>`SELECT bookmark_text FROM ${fast(TABLE)}`;
    return row.bookmark_text;
  }

  beforeAll(async () => {
    await fast`
      CREATE TABLE ${fast(TABLE)} (
        file_name TEXT NOT NULL,
        directory TEXT NOT NULL,
        bookmark_text TEXT NOT NULL,
        PRIMARY KEY (file_name, directory)
      )
    `;
    await slow`SELECT count(*) FROM ${slow(TABLE)}`;
  }, 60_000);

  afterAll(async () => {
    await fast`DROP TABLE IF EXISTS ${fast(TABLE)}`;
    await Promise.all([fast.end(), slow.end()]);
  }, 60_000);

  it('loses an overlapping autocommit write while reporting it as saved', async () => {
    await resetRow();

    // postgres.js sends a query only once it is awaited or executed.
    const slowWrite = slowUpsert(slow, SLOW_WRITE_SECONDS).execute();
    await overwriteWhileSlowWriteRuns();

    expect((await slowWrite).count).toBe(1);
    expect(await storedText()).toBe('fast writer');
  }, 30_000);

  it('lands the same overlapping write by running it again after the conflict', async () => {
    await resetRow();
    const delaysSeconds: number[] = [];

    const slowWrite = runWriteTransaction(slow, async (tx) => {
      const delaySeconds = delaysSeconds.length === 0 ? SLOW_WRITE_SECONDS : 0;
      delaysSeconds.push(delaySeconds);
      await slowUpsert(tx, delaySeconds);
    });
    await overwriteWhileSlowWriteRuns();
    await slowWrite;

    expect(delaysSeconds.length).toBeGreaterThan(1);
    expect(await storedText()).toBe('slow writer');
  }, 30_000);
});
