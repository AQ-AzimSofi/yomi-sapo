import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDsqlOptions, iamTokenSource, type DatabaseKind } from './connectionConfig';
import { applySchema } from './schemaRunner';

// Applies the schema twice into a scratch schema that is dropped afterwards, so the target's own
// tables are never touched. Each target runs only when configured:
// - SCHEMA_TEST_DATABASE_URL: a throwaway PostgreSQL database, never one that syncs to production
// - DSQL_TEST_ENDPOINT=<cluster id>.dsql.<region>.on.aws: a DSQL test cluster, as admin with a
//   token from the default AWS credentials. Never point it at a cluster that serves the app.
const POSTGRES_URL = process.env.SCHEMA_TEST_DATABASE_URL ?? '';
const DSQL_ENDPOINT = process.env.DSQL_TEST_ENDPOINT ?? '';
const SCRATCH_SCHEMA = `schema_runner_test_${Date.now()}`;
const TABLES = ['bookmarks', 'narration', 'text_entries', 'vocabulary_entries'];
// DSQL builds each index in a background job, about 20 s apiece on the test cluster.
const APPLY_TIMEOUT_MS = 10 * 60 * 1000;

const EXPECTED_INDEXES = [
  'bookmarks_file_name_directory_key',
  'bookmarks_pkey',
  'idx_text_entries_library',
  'idx_vocabulary_entries_created_at',
  'idx_vocabulary_entries_file',
  'idx_vocabulary_entries_word',
  'narration_file_name_directory_key',
  'narration_pkey',
  'text_entries_file_name_directory_key',
  'text_entries_pkey',
  'vocabulary_entries_pkey',
];

function regionOf(endpoint: string): string {
  const match = /\.dsql\.([a-z0-9-]+)\.on\.aws$/.exec(endpoint);
  if (!match) throw new Error(`DSQL_TEST_ENDPOINT is not a DSQL endpoint: ${endpoint}`);
  return match[1];
}

function connectTo(kind: DatabaseKind, searchPath?: string): postgres.Sql {
  const extra = { max: 1, onnotice: () => undefined, ...(searchPath ? { connection: { search_path: searchPath } } : {}) };
  if (kind === 'postgres') return postgres(POSTGRES_URL, extra);
  const settings = { endpoint: DSQL_ENDPOINT, user: 'admin', region: regionOf(DSQL_ENDPOINT) };
  return postgres({ ...buildDsqlOptions(settings, iamTokenSource(settings)), ...extra });
}

interface CatalogSnapshot {
  columns: string[];
  indexes: string[];
  sequences: string[];
}

async function snapshotCatalog(client: postgres.Sql): Promise<CatalogSnapshot> {
  const columns = await client<{ entry: string }[]>`
    SELECT table_name || '.' || column_name || ' ' || data_type || ' default ' || coalesce(column_default, '-') AS entry
    FROM information_schema.columns
    WHERE table_schema = ${SCRATCH_SCHEMA}
    ORDER BY table_name, ordinal_position
  `;
  const indexes = await client<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes WHERE schemaname = ${SCRATCH_SCHEMA} ORDER BY indexname
  `;
  const sequences = await client<{ sequence_name: string }[]>`
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = ${SCRATCH_SCHEMA} ORDER BY sequence_name
  `;
  return {
    columns: columns.map((row) => row.entry),
    indexes: indexes.map((row) => row.indexdef),
    sequences: sequences.map((row) => row.sequence_name),
  };
}

function indexNamesOf(snapshot: CatalogSnapshot): string[] {
  return snapshot.indexes.map((indexdef) => /INDEX (\S+) ON/.exec(indexdef)?.[1] ?? indexdef).sort();
}

const TARGETS: { kind: DatabaseKind; isConfigured: boolean }[] = [
  { kind: 'postgres', isConfigured: Boolean(POSTGRES_URL) },
  { kind: 'dsql', isConfigured: Boolean(DSQL_ENDPOINT) },
];

describe.each(TARGETS)('applySchema into a scratch schema on $kind', ({ kind, isConfigured }) => {
  const admin = isConfigured ? connectTo(kind) : null;
  const scratch = isConfigured ? connectTo(kind, SCRATCH_SCHEMA) : null;
  const snapshots: CatalogSnapshot[] = [];

  beforeAll(async () => {
    if (!admin || !scratch) return;
    await admin.unsafe(`CREATE SCHEMA ${SCRATCH_SCHEMA}`);
    await applySchema(scratch, kind);
    snapshots.push(await snapshotCatalog(scratch));
    await applySchema(scratch, kind);
    snapshots.push(await snapshotCatalog(scratch));
  }, APPLY_TIMEOUT_MS);

  afterAll(async () => {
    if (!admin || !scratch) return;
    const indexes = await admin<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${SCRATCH_SCHEMA} AND indexname LIKE 'idx_%'
    `;
    for (const { indexname } of indexes) await admin.unsafe(`DROP INDEX ${SCRATCH_SCHEMA}.${indexname}`);
    for (const table of TABLES) await admin.unsafe(`DROP TABLE IF EXISTS ${SCRATCH_SCHEMA}.${table}`);
    for (const table of TABLES) await admin.unsafe(`DROP SEQUENCE IF EXISTS ${SCRATCH_SCHEMA}.${table}_id_seq`);
    await admin.unsafe(`DROP SCHEMA ${SCRATCH_SCHEMA}`);
    await Promise.all([admin.end(), scratch.end()]);
  }, APPLY_TIMEOUT_MS);

  it.skipIf(!isConfigured)('creates the tables, their sequences and every index', () => {
    expect(indexNamesOf(snapshots[0])).toEqual(EXPECTED_INDEXES);
    expect(snapshots[0].sequences).toEqual(['bookmarks_id_seq', 'narration_id_seq', 'text_entries_id_seq']);
  });

  it.skipIf(!isConfigured)('gives the tables INT ids that default to their sequences', () => {
    const idColumns = snapshots[0].columns.filter((column) => /^\w+\.id /.test(column));
    expect(idColumns).toEqual([
      "bookmarks.id integer default nextval('bookmarks_id_seq'::regclass)",
      "narration.id integer default nextval('narration_id_seq'::regclass)",
      "text_entries.id integer default nextval('text_entries_id_seq'::regclass)",
      'vocabulary_entries.id character varying default -',
    ]);
  });

  it.skipIf(!isConfigured)('changes nothing when applied again', () => {
    expect(snapshots[1]).toEqual(snapshots[0]);
  });

  it.skipIf(!isConfigured)('returns a new id as a JavaScript number', async () => {
    const [row] = await scratch!<{ id: unknown }[]>`
      INSERT INTO bookmarks (file_name, directory, bookmark_text) VALUES ('ほん', 'd', '') RETURNING id
    `;
    expect(row.id).toBe(1);
  });
});
