import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseSync } from './textEntrySync';

const REMOTE_URL = 'postgresql://user:pass@ep-x.neon.tech/yomi_sapo';
const LOCAL_URL = 'postgresql://postgres:123@localhost:5433/yomi_sapo_test';
// See scripts/db/sync-text-entry.test.ts: a throwaway database with the app schema, unset in CI.
const TEST_DATABASE_URL = process.env.PIPELINE_TEST_DATABASE_URL;
const TEST_DIRECTORY = 'pipeline-test/chunk-sync';
// Each sync starts a Node with tsx, which a loaded machine can take a few seconds for.
const CHILD_SYNC_TIMEOUT_MS = 30_000;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('createDatabaseSync', () => {
  it('Test_createDatabaseSync_RefusesARemoteDatabase', () => {
    expect(() => createDatabaseSync(REMOTE_URL, {})).toThrow(/Refusing to sync chunks to ep-x\.neon\.tech/);
  });

  it('Test_createDatabaseSync_RefusesWhenAnyHostIsRemote', () => {
    expect(() => createDatabaseSync('postgresql://user:pass@localhost,ep-x.neon.tech/yomi_sapo', {})).toThrow(/Refusing/);
  });

  it('Test_createDatabaseSync_UsesDatabaseUrlFromTheEnvironment', () => {
    expect(() => createDatabaseSync(undefined, { DATABASE_URL: REMOTE_URL })).toThrow(/Refusing/);
  });

  it('Test_createDatabaseSync_FallsBackToPostgresUrl', () => {
    expect(() => createDatabaseSync(undefined, { POSTGRES_URL: REMOTE_URL })).toThrow(/Refusing/);
  });

  it('Test_createDatabaseSync_TheOptionBeatsTheEnvironment', () => {
    expect(() => createDatabaseSync(LOCAL_URL, { DATABASE_URL: REMOTE_URL })).not.toThrow();
  });

  it('Test_createDatabaseSync_WithoutAnyUrlSyncsNothing', async () => {
    const sync = createDatabaseSync(undefined, {});
    expect(await sync({ directory: TEST_DIRECTORY, fileName: 'none', filePath: 'missing.txt' })).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not synced to the database'));
  });
});

describe.skipIf(!TEST_DATABASE_URL)('createDatabaseSync against the test database', () => {
  const databaseUrl = TEST_DATABASE_URL ?? '';
  const checkSql = postgres(databaseUrl, { max: 1 });
  // Made in beforeAll: the suite body is collected even when the suite is skipped.
  const workDir = path.join(os.tmpdir(), `yomi-chunk-sync-${process.pid}`);

  beforeAll(() => {
    fs.mkdirSync(workDir, { recursive: true });
  });

  afterAll(async () => {
    await checkSql`DELETE FROM text_entries WHERE directory = ${TEST_DIRECTORY}`;
    await checkSql.end();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('Test_sync_UpsertsTheReaderFileThroughSyncTextEntry', async () => {
    if (!new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('PIPELINE_TEST_DATABASE_URL must name a database ending in _test');
    const filePath = path.join(workDir, 'book-rephrase-furigana.txt');
    fs.writeFileSync(filePath, '< <ruby>猫<rt>ねこ</rt></ruby>がいる。\r\n>> ねこがいる。');

    const isSynced = await createDatabaseSync(databaseUrl, {})({ directory: TEST_DIRECTORY, fileName: 'book-rephrase-furigana', filePath });

    expect(isSynced).toBe(true);
    const rows = await checkSql<{ content: string }[]>`
      SELECT content FROM text_entries WHERE directory = ${TEST_DIRECTORY} AND file_name = 'book-rephrase-furigana'`;
    expect(rows.map((row) => row.content)).toEqual(['< <ruby>猫<rt>ねこ</rt></ruby>がいる。\n>> ねこがいる。']);
  }, CHILD_SYNC_TIMEOUT_MS);

  it('Test_sync_AFailedSyncReturnsFalse', async () => {
    const sync = createDatabaseSync(databaseUrl, {});
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sync({ directory: TEST_DIRECTORY, fileName: 'missing', filePath: path.join(workDir, 'missing.txt') })).toBe(false);
  }, CHILD_SYNC_TIMEOUT_MS);
});
