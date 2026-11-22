import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from './connection';
import { errorCodeOf } from './errorCode';
import { getRubyRegistry, hideRubyRegistryItem, saveRubyRegistryEntry } from './rubyRegistryQueries.sql';
import { schemaStatementsFor } from './schema';

// Runs the registry queries against a scratch schema that is dropped afterwards, first without the
// table (as on Neon), then with it. One target per run:
// - DSQL_TEST_ENDPOINT=<cluster id>.dsql.<region>.on.aws: a DSQL test cluster, as admin with a token
//   from the default AWS credentials. Never a cluster that serves the app.
// - otherwise REGISTRY_TEST_DATABASE_URL: a throwaway PostgreSQL database, never one that syncs to production.
const testTarget = vi.hoisted(() => {
  const dsqlEndpoint = process.env.DSQL_TEST_ENDPOINT ?? '';
  const databaseUrl = process.env.REGISTRY_TEST_DATABASE_URL ?? '';
  const scratchSchema = `ruby_registry_test_${Date.now()}`;

  async function connect(searchPath?: string) {
    const { default: postgres } = await import('postgres');
    const { buildDsqlOptions, DSQL_ADMIN_USER, iamTokenSource, regionOfDsqlEndpoint } = await import('./connectionConfig');
    const options = { max: 1, onnotice: () => undefined, ...(searchPath ? { connection: { search_path: searchPath } } : {}) };
    if (!dsqlEndpoint) return postgres(databaseUrl, options);
    const settings = { endpoint: dsqlEndpoint, region: regionOfDsqlEndpoint(dsqlEndpoint) ?? '', user: DSQL_ADMIN_USER };
    return postgres({ ...buildDsqlOptions(settings, iamTokenSource(settings)), ...options });
  }

  return { isConfigured: Boolean(dsqlEndpoint || databaseUrl), scratchSchema, connect };
});

vi.mock('./connection', async () => ({
  sql: testTarget.isConfigured ? await testTarget.connect(testTarget.scratchSchema) : null,
}));

const KEY = { directory: 'bookv2-furigana', bookName: 'ほん' };
const OTHER_BOOK = { directory: 'bookv2-furigana', bookName: 'べつのほん' };
const REGISTRY_TABLE = schemaStatementsFor('dsql').find((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS ruby_registry_entries'));
const TIMEOUT_MS = 60 * 1000;

function entry(kanji: string, reading: string) {
  return { kanji, reading, source: 'user' as const, note: '' };
}

async function caughtCode(work: Promise<unknown>): Promise<string | undefined> {
  return work.then(() => 'no error', errorCodeOf);
}

async function entryReadings(key: typeof KEY): Promise<string[]> {
  return (await getRubyRegistry(key)).entries.map(({ kanji, reading }) => `${kanji}:${reading}`);
}

describe.skipIf(!testTarget.isConfigured)('the ruby registry queries on a scratch schema', () => {
  const adminPromise = testTarget.isConfigured ? testTarget.connect() : null;

  beforeAll(async () => {
    await (await adminPromise!).unsafe(`CREATE SCHEMA ${testTarget.scratchSchema}`);
  }, TIMEOUT_MS);

  afterAll(async () => {
    const admin = await adminPromise!;
    await sql.end();
    await admin.unsafe(`DROP TABLE IF EXISTS ${testTarget.scratchSchema}.ruby_registry_entries`);
    await admin.unsafe(`DROP SCHEMA ${testTarget.scratchSchema}`);
    await admin.end();
  }, TIMEOUT_MS);

  it('fails a read and a write with 42P01 while the table does not exist, as on Neon', async () => {
    expect(await caughtCode(getRubyRegistry(KEY))).toBe('42P01');
    expect(await caughtCode(saveRubyRegistryEntry(KEY, entry('本', 'ほん')))).toBe('42P01');
  }, TIMEOUT_MS);

  describe('with the table', () => {
    beforeAll(async () => {
      await sql.unsafe(REGISTRY_TABLE!);
    }, TIMEOUT_MS);

    it("saves entries and lists only the book's own, in code point order", async () => {
      await saveRubyRegistryEntry(KEY, entry('候補', 'こうほ'));
      await saveRubyRegistryEntry(KEY, entry('仙水', 'せんすい'));
      await saveRubyRegistryEntry(OTHER_BOOK, entry('別', 'べつ'));

      expect(await entryReadings(KEY)).toEqual(['仙水:せんすい', '候補:こうほ']);
    }, TIMEOUT_MS);

    it('replaces the reading and note of a word saved again', async () => {
      await saveRubyRegistryEntry(KEY, { ...entry('仙水', 'せんみず'), note: 'メモ' });

      expect((await getRubyRegistry(KEY)).entries[0]).toEqual({ kanji: '仙水', reading: 'せんみず', source: 'user', note: 'メモ' });
    }, TIMEOUT_MS);

    it('hides a deleted entry, and shows it again when it is saved', async () => {
      await hideRubyRegistryItem(KEY, '候補', 'entry');
      const afterDelete = await entryReadings(KEY);
      await saveRubyRegistryEntry(KEY, entry('候補', 'こうほ'));

      expect(afterDelete).toEqual(['仙水:せんみず']);
      expect(await entryReadings(KEY)).toEqual(['仙水:せんみず', '候補:こうほ']);
    }, TIMEOUT_MS);

    it('lists a word without a reading as a suggestion until it is ignored', async () => {
      await sql`
        INSERT INTO ruby_registry_entries (directory, book_name, kanji, source, occurrences)
        VALUES (${KEY.directory}, ${KEY.bookName}, '提案', 'epub_smart', 3)
      `;
      const listed = (await getRubyRegistry(KEY)).suggestions;
      await hideRubyRegistryItem(KEY, '提案', 'entry');
      const afterWrongType = (await getRubyRegistry(KEY)).suggestions;
      await hideRubyRegistryItem(KEY, '提案', 'suggestion');

      expect(listed).toEqual([{ kanji: '提案', occurrences: 3 }]);
      expect(afterWrongType).toEqual(listed);
      expect((await getRubyRegistry(KEY)).suggestions).toEqual([]);
    }, TIMEOUT_MS);
  });
});
