import { afterEach, describe, expect, it, vi } from 'vitest';

const ENTRY_SCRIPTS = [
  '../epub-to-book.ts',
  '../ocr/ocr-pages.ts',
  '../kindle/page-turner.ts',
  '../audio/build-narration.ts',
  '../db/sync.ts',
  '../db/sync-narration.ts',
  '../db/clean-book-text.ts',
  '../db/migrate.ts',
  '../db/apply-schema-dsql.ts',
  '../db/copy-to-dsql.ts',
  '../dev-with-sync.ts',
  '../auth/generate-password-hash.ts',
];

describe('entry scripts', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(ENTRY_SCRIPTS)('Test_EntryScript_ImportsWithoutRunning %s', async (scriptPath) => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, 'log');
    const errorSpy = vi.spyOn(console, 'error');
    await import(scriptPath);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
