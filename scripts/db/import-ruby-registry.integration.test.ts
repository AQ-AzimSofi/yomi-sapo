import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DSQL_ADMIN_USER, regionOfDsqlEndpoint } from '../../lib/db/connectionConfig';
import { createPgClient } from '../../lib/db/pgClient';
import { prodClientConfig } from '../../lib/db/prodDatabase';
import { schemaStatementsFor } from '../../lib/db/schema';
import { importRubyRegistry, readRegistryFiles, type ImportReport, type RegistryFile } from './rubyRegistryImport';

// Imports ruby-registry.json files from a temporary folder into a scratch schema that is dropped
// afterwards. Each target runs only when configured:
// - REGISTRY_IMPORT_TEST_LOCAL_URL: a throwaway PostgreSQL database, never one that syncs to production.
// - DSQL_TEST_ENDPOINT=<cluster id>.dsql.<region>.on.aws: a DSQL test cluster, as admin with a token
//   from the default AWS credentials, through the prod database factory. Never a cluster that serves the app.
const LOCAL_URL = process.env.REGISTRY_IMPORT_TEST_LOCAL_URL ?? '';
const DSQL_ENDPOINT = process.env.DSQL_TEST_ENDPOINT ?? '';
const REGISTRY_TABLE = schemaStatementsFor('dsql').find((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS ruby_registry_entries'));
const TIMEOUT_MS = 2 * 60 * 1000;
// More words than one insert statement carries, so the import sends several.
const LONG_BOOK_WORDS = 1200;

const SHORT_BOOK = {
  bookTitle: '感謝脳',
  entries: [
    { kanji: '仙水', reading: 'せん', source: 'epub_smart', note: '' },
    { kanji: '冥利', reading: 'みょう', source: 'epub_smart', note: '' },
    { kanji: '仕合', reading: 'し', source: 'epub_smart', note: '' },
  ],
  suggestions: [{ kanji: '候補', occurrences: 4 }],
};
const LONG_BOOK = {
  bookTitle: '長い本',
  entries: Array.from({ length: LONG_BOOK_WORDS }, (_, wordI) => ({ kanji: `語${wordI}`, reading: `ご${wordI}`, source: 'epub_smart', note: '' })),
};
const TOTAL_WORDS = SHORT_BOOK.entries.length + SHORT_BOOK.suggestions.length + LONG_BOOK_WORDS;

function connectTo(kind: 'postgres' | 'dsql'): Client {
  if (kind === 'postgres') return createPgClient({ connectionString: LOCAL_URL }, 'import test');
  const settings = { endpoint: DSQL_ENDPOINT, region: regionOfDsqlEndpoint(DSQL_ENDPOINT) ?? '', user: DSQL_ADMIN_USER };
  return createPgClient(prodClientConfig({ kind: 'dsql', settings }), 'import test');
}

async function writeRegistryFolder(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ruby-registry-import-test-'));
  const books: [string, unknown][] = [
    ['bookv2-furigana/感謝脳', SHORT_BOOK],
    ['bookv2-furigana/長い本', LONG_BOOK],
  ];
  for (const [bookFolder, registry] of books) {
    await mkdir(path.join(root, bookFolder), { recursive: true });
    await writeFile(path.join(root, bookFolder, 'ruby-registry.json'), JSON.stringify(registry));
  }
  return root;
}

const TARGETS = [
  { kind: 'postgres' as const, isConfigured: Boolean(LOCAL_URL) },
  { kind: 'dsql' as const, isConfigured: Boolean(DSQL_ENDPOINT) },
];

describe.each(TARGETS)('import-ruby-registry into a scratch schema on $kind', ({ kind, isConfigured }) => {
  const scratchSchema = `ruby_registry_import_test_${Date.now()}`;
  const client = isConfigured ? connectTo(kind) : null;
  const reports: ImportReport[] = [];
  const state = { root: '', files: [] as RegistryFile[] };

  async function countRows(where = 'TRUE'): Promise<number> {
    const { rows } = await client!.query(`SELECT count(*)::int AS count FROM ruby_registry_entries WHERE ${where}`);
    return rows[0].count;
  }

  beforeAll(async () => {
    if (!client) return;
    state.root = await writeRegistryFolder();
    state.files = await readRegistryFiles(state.root);
    await client.connect();
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}`);
    await client.query(REGISTRY_TABLE!);
    reports.push(await importRubyRegistry(client, state.files, false));
    reports.push(await importRubyRegistry(client, state.files, true));
  }, TIMEOUT_MS);

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP TABLE IF EXISTS ${scratchSchema}.ruby_registry_entries`);
    await client.query(`DROP SCHEMA ${scratchSchema}`);
    await client.end();
    await rm(state.root, { recursive: true, force: true });
  }, TIMEOUT_MS);

  it.skipIf(!isConfigured)('writes nothing on a dry run, then inserts every word with --apply', async () => {
    const [dryRun, applied] = reports;

    expect([dryRun.plan.toInsert.length, dryRun.inserted]).toEqual([TOTAL_WORDS, null]);
    expect([applied.plan.toInsert.length, applied.inserted]).toEqual([TOTAL_WORDS, TOTAL_WORDS]);
    expect(await countRows()).toBe(TOTAL_WORDS);
    expect(await countRows("directory = 'bookv2-furigana' AND book_name = '感謝脳' AND reading IS NULL AND occurrences = 4")).toBe(1);
  });

  it.skipIf(!isConfigured)('inserts nothing when run again', async () => {
    const again = await importRubyRegistry(client!, state.files, true);

    expect(again).toEqual({ plan: { toInsert: [], unchanged: TOTAL_WORDS, hidden: 0, kept: [] }, inserted: 0 });
  }, TIMEOUT_MS);

  it.skipIf(!isConfigured)("keeps the owner's edit and delete, and brings back only a word removed from the table", async () => {
    await client!.query("UPDATE ruby_registry_entries SET reading = 'せんすい', source = 'user' WHERE kanji = '仙水'");
    await client!.query("UPDATE ruby_registry_entries SET ignored = TRUE WHERE kanji = '冥利'");
    await client!.query("DELETE FROM ruby_registry_entries WHERE kanji = '仕合'");

    const afterEdits = await importRubyRegistry(client!, state.files, true);

    expect(afterEdits.inserted).toBe(1);
    expect([afterEdits.plan.hidden, afterEdits.plan.kept.map((row) => row.kanji)]).toEqual([1, ['仙水']]);
    expect(await countRows("kanji = '仙水' AND reading = 'せんすい' AND source = 'user'")).toBe(1);
    expect(await countRows("kanji = '冥利' AND ignored")).toBe(1);
  }, TIMEOUT_MS);
});
