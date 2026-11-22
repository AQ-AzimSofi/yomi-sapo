import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDsqlOptions, DSQL_ADMIN_USER, iamTokenSource, regionOfDsqlEndpoint } from '../../lib/db/connectionConfig';
import { applySchema } from '../../lib/db/schemaRunner';
import { runWriteTransaction } from '../../lib/db/writeTransaction';
import { copyDatabase, type CopyReport } from './copy-to-dsql';
import { COPY_TABLES, IMPORTED_TABLES, isIdentical } from './copyTables';

// Copies a PostgreSQL database into a scratch schema of an Aurora DSQL test cluster and drops the
// schema afterwards. Runs only when both are configured:
// - COPY_TEST_SOURCE_URL: a throwaway PostgreSQL database holding app tables; it is only read.
//   Never one that syncs to production, and never production itself.
// - DSQL_TEST_ENDPOINT=<cluster id>.dsql.<region>.on.aws: a DSQL test cluster, as admin with a
//   token from the default AWS credentials. Never a cluster that serves the app.
const SOURCE_URL = process.env.COPY_TEST_SOURCE_URL ?? '';
const DSQL_ENDPOINT = process.env.DSQL_TEST_ENDPOINT ?? '';
const IS_CONFIGURED = Boolean(SOURCE_URL && DSQL_ENDPOINT);
const SCRATCH_SCHEMA = `copy_to_dsql_test_${Date.now()}`;
const TABLES = COPY_TABLES.map((spec) => spec.name);
// The schema also creates the tables the copy leaves to their import scripts.
const SCHEMA_TABLES = [...TABLES, ...IMPORTED_TABLES.map((table) => table.name)];
// DSQL builds each index of the schema in a background job, about 20 s apiece.
const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
const COPY_TIMEOUT_MS = 5 * 60 * 1000;
const QUIET = { shouldDeleteExtra: false, log: () => undefined };

function connectToCluster(searchPath?: string): postgres.Sql {
  const settings = { endpoint: DSQL_ENDPOINT, region: regionOfDsqlEndpoint(DSQL_ENDPOINT) ?? '', user: DSQL_ADMIN_USER };
  const connection = searchPath ? { connection: { search_path: searchPath } } : {};
  return postgres({ ...buildDsqlOptions(settings, iamTokenSource(settings)), max: 1, onnotice: () => undefined, ...connection });
}

async function countRows(client: postgres.Sql): Promise<number[]> {
  return Promise.all(TABLES.map(async (table) => Number((await client.unsafe(`SELECT count(*) AS count FROM ${table}`))[0].count)));
}

function writtenCounts(report: CopyReport): number[] {
  return report.tables.map((table) => table.written);
}

function identicalTables(report: CopyReport): boolean[] {
  return report.tables.map((table) => isIdentical(table.verification));
}

describe.skipIf(!IS_CONFIGURED)('copyDatabase from PostgreSQL into a scratch schema on Aurora DSQL', () => {
  const source = IS_CONFIGURED ? postgres(SOURCE_URL, { max: 1, onnotice: () => undefined }) : null;
  const admin = IS_CONFIGURED ? connectToCluster() : null;
  const target = IS_CONFIGURED ? connectToCluster(SCRATCH_SCHEMA) : null;
  const reports: CopyReport[] = [];

  beforeAll(async () => {
    await admin!.unsafe(`CREATE SCHEMA ${SCRATCH_SCHEMA}`);
    await applySchema(target!, 'dsql');
    reports.push(await copyDatabase(source!, target!, QUIET));
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    const indexes = await admin!<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${SCRATCH_SCHEMA} AND indexname LIKE 'idx_%'
    `;
    for (const { indexname } of indexes) await admin!.unsafe(`DROP INDEX ${SCRATCH_SCHEMA}.${indexname}`);
    for (const table of SCHEMA_TABLES) await admin!.unsafe(`DROP TABLE IF EXISTS ${SCRATCH_SCHEMA}.${table}`);
    for (const table of TABLES) await admin!.unsafe(`DROP SEQUENCE IF EXISTS ${SCRATCH_SCHEMA}.${table}_id_seq`);
    await admin!.unsafe(`DROP SCHEMA ${SCRATCH_SCHEMA}`);
    await Promise.all([source!.end(), admin!.end(), target!.end()]);
  }, SETUP_TIMEOUT_MS);

  it('copies every row of every table and finds each identical', async () => {
    const [first] = reports;

    expect(identicalTables(first)).toEqual([true, true, true, true]);
    expect(writtenCounts(first)).toEqual(await countRows(source!));
    expect(await countRows(target!)).toEqual(await countRows(source!));
  });

  it('keeps jsonb as JSON and content_bytes only where it matches the text', async () => {
    const [cues] = await target!`SELECT count(*)::int AS count FROM narration WHERE jsonb_typeof(cues) <> 'array'`;
    const [staleBytes] = await target!`
      SELECT count(*)::int AS count FROM text_entries WHERE content_bytes IS NOT NULL AND content_bytes <> octet_length(content)
    `;

    expect(cues.count).toBe(0);
    expect(staleBytes.count).toBe(0);
  });

  it('writes nothing when run again', async () => {
    const second = await copyDatabase(source!, target!, QUIET);

    expect(writtenCounts(second)).toEqual([0, 0, 0, 0]);
    expect(identicalTables(second)).toEqual([true, true, true, true]);
  }, COPY_TIMEOUT_MS);

  it('rewrites a deleted or changed row, numbers a new row past the copied ids, and reports an extra row', async () => {
    const [{ maxId }] = await source!`SELECT max(id)::int AS "maxId" FROM bookmarks`;
    await runWriteTransaction(target!, async (tx) => {
      await tx`DELETE FROM bookmarks WHERE id = (SELECT min(id) FROM bookmarks)`;
      await tx`UPDATE vocabulary_entries SET notes = 'changed in the target' WHERE id = (SELECT min(id) FROM vocabulary_entries)`;
      await tx`INSERT INTO bookmarks (file_name, directory, bookmark_text) VALUES ('copy-test', 'copy-test', '')`;
    });
    const [extra] = await target!<{ id: number }[]>`SELECT id FROM bookmarks WHERE directory = 'copy-test'`;
    const third = await copyDatabase(source!, target!, QUIET);

    expect(extra.id).toBeGreaterThan(maxId);
    expect(writtenCounts(third)).toEqual([1, 0, 0, 1]);
    expect(third.tables[0].verification.extra).toEqual([JSON.stringify([String(extra.id)])]);
    expect(identicalTables(third)).toEqual([false, true, true, true]);
  }, COPY_TIMEOUT_MS);

  it('deletes the extra row with --delete-extra', async () => {
    const fourth = await copyDatabase(source!, target!, { ...QUIET, shouldDeleteExtra: true });

    expect(fourth.tables.map((table) => table.deleted)).toEqual([1, 0, 0, 0]);
    expect(identicalTables(fourth)).toEqual([true, true, true, true]);
  }, COPY_TIMEOUT_MS);
});
