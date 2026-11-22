import type { Client } from 'pg';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDsqlOptions, DSQL_ADMIN_USER, iamTokenSource, regionOfDsqlEndpoint } from './connectionConfig';
import { createPgClient } from './pgClient';
import { prodClientConfig } from './prodDatabase';
import { applySchema } from './schemaRunner';
import { pull, push, type SyncResult } from './sync-core';
import { runWriteTransaction } from './writeTransaction';

// Runs the dev sync between a local PostgreSQL database and a scratch schema of an Aurora DSQL test
// cluster standing in for production, and drops the schema afterwards. Runs only when both are set:
// - SYNC_TEST_LOCAL_URL: a throwaway PostgreSQL database with app tables. The pull writes to it, so
//   never the local database that syncs to production.
// - DSQL_TEST_ENDPOINT=<cluster id>.dsql.<region>.on.aws: a DSQL test cluster, as admin with a token
//   from the default AWS credentials. Never a cluster that serves the app.
const LOCAL_URL = process.env.SYNC_TEST_LOCAL_URL ?? '';
const DSQL_ENDPOINT = process.env.DSQL_TEST_ENDPOINT ?? '';
const IS_CONFIGURED = Boolean(LOCAL_URL && DSQL_ENDPOINT);
const SCRATCH_SCHEMA = `sync_core_test_${Date.now()}`;
// The pull copies this run's new bookmark into the local database, so each run names its own.
const NEW_BOOKMARK_DIRECTORY = `sync-test-${Date.now()}`;
const SCHEMA_TABLES = ['bookmarks', 'narration', 'text_entries', 'vocabulary_entries'];
const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const SYNC_TIMEOUT_MS = 3 * 60 * 1000;
const DSQL_SETTINGS = { endpoint: DSQL_ENDPOINT, region: regionOfDsqlEndpoint(DSQL_ENDPOINT) ?? '', user: DSQL_ADMIN_USER };

function connectToCluster(searchPath?: string): postgres.Sql {
  const connection = searchPath ? { connection: { search_path: searchPath } } : {};
  return postgres({ ...buildDsqlOptions(DSQL_SETTINGS, iamTokenSource(DSQL_SETTINGS)), max: 1, onnotice: () => undefined, ...connection });
}

function rowsByTable(results: SyncResult[]): Record<string, number> {
  return Object.fromEntries(results.map((result) => [result.table, result.rows]));
}

async function countRows(client: Client): Promise<Record<string, number>> {
  const counts = await Promise.all(
    ['bookmarks', 'vocabulary_entries', 'text_entries'].map(async (table) => {
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
      return [table, rows[0].count as number] as const;
    })
  );
  return Object.fromEntries(counts);
}

describe.skipIf(!IS_CONFIGURED)('the dev sync with a scratch schema on Aurora DSQL as production', () => {
  const admin = IS_CONFIGURED ? connectToCluster() : null;
  const scratch = IS_CONFIGURED ? connectToCluster(SCRATCH_SCHEMA) : null;
  const prod = IS_CONFIGURED ? createPgClient(prodClientConfig({ kind: 'dsql', settings: DSQL_SETTINGS }), 'prod') : null;
  const local = IS_CONFIGURED ? createPgClient({ connectionString: LOCAL_URL }, 'local') : null;
  const pushes: SyncResult[][] = [];

  beforeAll(async () => {
    await admin!.unsafe(`CREATE SCHEMA ${SCRATCH_SCHEMA}`);
    await applySchema(scratch!, 'dsql');
    await Promise.all([prod!.connect(), local!.connect()]);
    await prod!.query(`SET search_path TO ${SCRATCH_SCHEMA}`);
    pushes.push(await push(prod!, local!));
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await Promise.all([prod!.end(), local!.end()]);
    const indexes = await admin!<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${SCRATCH_SCHEMA} AND indexname LIKE 'idx_%'
    `;
    for (const { indexname } of indexes) await admin!.unsafe(`DROP INDEX ${SCRATCH_SCHEMA}.${indexname}`);
    for (const table of SCHEMA_TABLES) await admin!.unsafe(`DROP TABLE IF EXISTS ${SCRATCH_SCHEMA}.${table}`);
    for (const table of SCHEMA_TABLES) await admin!.unsafe(`DROP SEQUENCE IF EXISTS ${SCRATCH_SCHEMA}.${table}_id_seq`);
    await admin!.unsafe(`DROP SCHEMA ${SCRATCH_SCHEMA}`);
    await Promise.all([admin!.end(), scratch!.end()]);
  }, SETUP_TIMEOUT_MS);

  it('pushes every book, bookmark and word into an empty production without losing the connection', async () => {
    const [first] = pushes;

    expect(first.map((result) => result.failed)).toEqual([0, 0, 0]);
    expect(rowsByTable(first)).toEqual(await countRows(local!));
    expect(await countRows(prod!)).toEqual(await countRows(local!));
  });

  it('stores each book text unchanged, with content_bytes only where it matches', async () => {
    const { rows: localBooks } = await local!.query('SELECT file_name, directory, content FROM text_entries');
    const { rows: prodBooks } = await prod!.query('SELECT file_name, directory, content, content_bytes FROM text_entries');
    const prodByKey = new Map(prodBooks.map((book) => [`${book.directory}/${book.file_name}`, book]));

    expect(localBooks.filter((book) => prodByKey.get(`${book.directory}/${book.file_name}`)?.content !== book.content)).toEqual([]);
    expect(prodBooks.filter((book) => book.content_bytes !== null && book.content_bytes !== Buffer.byteLength(book.content))).toEqual([]);
  }, SYNC_TIMEOUT_MS);

  it('numbers pushed rows from production sequences, so the app can insert after a push', async () => {
    await runWriteTransaction(scratch!, async (tx) => {
      await tx`INSERT INTO bookmarks (file_name, directory, bookmark_text) VALUES ('sync-test', ${NEW_BOOKMARK_DIRECTORY}, '')`;
    });
    const { rows } = await prod!.query('SELECT count(*)::int AS count FROM bookmarks WHERE directory = $1', [NEW_BOOKMARK_DIRECTORY]);

    expect(rows[0].count).toBe(1);
  });

  it('pushes nothing the second time', async () => {
    const second = await push(prod!, local!);

    expect(second.map((result) => result.rows)).toEqual([0, 0, 0]);
  }, SYNC_TIMEOUT_MS);

  it('pulls a bookmark that production changed later', async () => {
    const [bookmark] = await scratch!<{ file_name: string; directory: string }[]>`
      SELECT file_name, directory FROM bookmarks WHERE directory NOT LIKE 'sync-test%' ORDER BY id LIMIT 1
    `;
    await runWriteTransaction(scratch!, async (tx) => {
      await tx`
        UPDATE bookmarks SET bookmark_page = 999, updated_at = now()::timestamp + interval '1 day'
        WHERE file_name = ${bookmark.file_name} AND directory = ${bookmark.directory}
      `;
    });

    const pulled = await pull(prod!, local!);
    const { rows } = await local!.query('SELECT bookmark_page FROM bookmarks WHERE file_name = $1 AND directory = $2', [
      bookmark.file_name,
      bookmark.directory,
    ]);

    expect(rowsByTable(pulled).bookmarks).toBe(2);
    expect(rows[0].bookmark_page).toBe(999);
  }, SYNC_TIMEOUT_MS);
});
