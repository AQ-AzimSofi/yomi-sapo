import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A database made for these tests, such as postgresql://postgres:123@localhost:5433/yomi_sapo_pipeline_test
// with lib/db/schema.ts applied. Unset (as in CI), the database tests are skipped.
const TEST_DATABASE_URL = process.env.PIPELINE_TEST_DATABASE_URL;
const TEST_DIRECTORY = 'pipeline-test/本';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-sync-'));

function writeBookFile(fileName: string, content: string): string {
  const filePath = path.join(workDir, `${fileName}.txt`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function importWithDatabaseUrl(databaseUrl: string) {
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv('POSTGRES_URL', '');
  vi.resetModules();
  return import('./sync-text-entry');
}

afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('syncTextEntryFile', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('Test_syncTextEntryFile_RefusesARemoteDatabaseBeforeConnecting', async () => {
    const { syncTextEntryFile } = await importWithDatabaseUrl('postgresql://user:pass@ep-x.neon.tech/yomi_sapo');
    const target = { directory: TEST_DIRECTORY, fileName: '本', filePath: writeBookFile('remote', '本文') };
    await expect(syncTextEntryFile(target)).rejects.toThrow(/refusing to write to ep-x\.neon\.tech/);
  });

  it('Test_syncTextEntryFile_RefusesWhenAnyHostIsRemote', async () => {
    const { syncTextEntryFile } = await importWithDatabaseUrl('postgresql://user:pass@localhost,ep-x.neon.tech/yomi_sapo');
    const target = { directory: TEST_DIRECTORY, fileName: '本', filePath: writeBookFile('mixed', '本文') };
    await expect(syncTextEntryFile(target)).rejects.toThrow(/refusing/);
  });

  it('Test_syncTextEntryFile_NoDatabaseUrlThrows', async () => {
    const { syncTextEntryFile } = await importWithDatabaseUrl('');
    const target = { directory: TEST_DIRECTORY, fileName: '本', filePath: writeBookFile('none', '本文') };
    await expect(syncTextEntryFile(target)).rejects.toThrow(/No DATABASE_URL/);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('syncTextEntryFile against the test database', () => {
  const databaseUrl = TEST_DATABASE_URL ?? '';
  const checkSql = postgres(databaseUrl, { max: 1 });

  async function readContents(fileName: string): Promise<string[]> {
    const rows = await checkSql<{ content: string }[]>`
      SELECT content FROM text_entries WHERE directory = ${TEST_DIRECTORY} AND file_name = ${fileName}`;
    return rows.map((row) => row.content);
  }

  // One module instance, so the tests share one connection pool and afterAll can close it.
  beforeAll(async () => {
    if (!new URL(databaseUrl).pathname.endsWith('_test')) {
      throw new Error(`PIPELINE_TEST_DATABASE_URL must name a database ending in _test, got ${new URL(databaseUrl).pathname}`);
    }
    await importWithDatabaseUrl(databaseUrl);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await checkSql`DELETE FROM text_entries WHERE directory = ${TEST_DIRECTORY}`;
    await checkSql.end();
    const { sql } = await import('@/lib/db/connection');
    await sql.end();
  });

  it('Test_syncTextEntryFile_InsertsTheFile', async () => {
    const { syncTextEntryFile } = await import('./sync-text-entry');
    await syncTextEntryFile({ directory: TEST_DIRECTORY, fileName: 'inserted', filePath: writeBookFile('inserted', '吾輩は猫である。') });
    expect(await readContents('inserted')).toEqual(['吾輩は猫である。']);
  });

  it('Test_syncTextEntryFile_ASecondSyncReplacesTheRow', async () => {
    const { syncTextEntryFile } = await import('./sync-text-entry');
    await syncTextEntryFile({ directory: TEST_DIRECTORY, fileName: 'updated', filePath: writeBookFile('updated', '一章') });
    await syncTextEntryFile({ directory: TEST_DIRECTORY, fileName: 'updated', filePath: writeBookFile('updated', '一章\n\n二章') });
    expect(await readContents('updated')).toEqual(['一章\n\n二章']);
  });

  it('Test_syncTextEntryFile_StoresWindowsLineEndsAsUnix', async () => {
    const { syncTextEntryFile } = await import('./sync-text-entry');
    await syncTextEntryFile({ directory: TEST_DIRECTORY, fileName: 'crlf', filePath: writeBookFile('crlf', '猫\r\n\r\n犬') });
    expect(await readContents('crlf')).toEqual(['猫\n\n犬']);
  });
});
