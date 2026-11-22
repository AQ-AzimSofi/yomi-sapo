import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP_TEXT, parseCliOptions, runCli } from './epub-to-book';
import { runBook } from './pipeline/runner';
import { assertPythonHasMeCab } from './shared/python';

vi.mock('./shared/python', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shared/python')>()),
  assertPythonHasMeCab: vi.fn(),
}));
vi.mock('./pipeline/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pipeline/runner')>()),
  runBook: vi.fn(async () => ({ bookName: 'book', sourceDir: 'public/bookv2-furigana/book' })),
}));

describe('parseCliOptions', () => {
  it('Test_parseCliOptions_Defaults', () => {
    expect(parseCliOptions(['book.epub'])).toEqual({
      inputPath: path.resolve('book.epub'),
      outputDir: 'bookv2-furigana',
      chunkSize: 5000,
      delaySeconds: 0,
      model: 'sonnet',
      skipRephrase: false,
      skipExtract: false,
      skipImages: false,
      filter: 'all',
      reset: false,
      dryRun: false,
    });
  });

  it('Test_parseCliOptions_EveryFlag', () => {
    const args = [
      'book.epub', '--output-dir', 'out', '--chunk-size', '300', '--delay', '5', '--model', 'gemini-3.5-flash',
      '--skip-rephrase', '--skip-extract', '--skip-images', '--filter', 'n3', '--reset', '--dry-run',
      '--database-url', 'postgresql://postgres:123@localhost:5433/yomi_sapo_test',
    ];
    expect(parseCliOptions(args)).toEqual({
      inputPath: path.resolve('book.epub'),
      outputDir: 'out',
      chunkSize: 300,
      delaySeconds: 5,
      model: 'gemini-3.5-flash',
      skipRephrase: true,
      skipExtract: true,
      skipImages: true,
      filter: 'n3',
      reset: true,
      dryRun: true,
      databaseUrl: 'postgresql://postgres:123@localhost:5433/yomi_sapo_test',
    });
  });

  it('Test_parseCliOptions_ApiUrlIsIgnoredWithAWarning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const options = parseCliOptions(['book.epub', '--api-url', 'http://localhost:3333', '--reset']);
    expect(options.reset).toBe(true);
    expect(options).not.toHaveProperty('apiUrl');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('--api-url http://localhost:3333 is ignored'));
    warnSpy.mockRestore();
  });

  it('Test_parseCliOptions_FlagsMayComeBeforeTheInput', () => {
    expect(parseCliOptions(['--reset', 'book.epub']).inputPath).toBe(path.resolve('book.epub'));
  });

  it('Test_parseCliOptions_MissingInputThrows', () => {
    expect(() => parseCliOptions(['--reset'])).toThrow('Pass the EPUB');
  });

  it('Test_parseCliOptions_BadChunkSizeThrows', () => {
    expect(() => parseCliOptions(['book.epub', '--chunk-size', 'big'])).toThrow('--chunk-size must be a whole number of at least 1, got "big".');
  });
});

describe('HELP_TEXT', () => {
  it.each([
    '--output-dir <dir>',
    '(default: bookv2-furigana)',
    '(default: 5000)',
    '(default: sonnet)',
    '(one of all, n3; default: all)',
    '(default: DATABASE_URL, then POSTGRES_URL)',
  ])('Test_HELP_TEXT_ShowsTheSchemaDefaults %s', (expectedText) => {
    expect(HELP_TEXT).toContain(expectedText);
  });
});

describe('runCli', () => {
  const bookTextPath = path.join(os.tmpdir(), 'epub-to-book-cli-test', 'book.txt');

  function writeBookText(): void {
    fs.mkdirSync(path.dirname(bookTextPath), { recursive: true });
    fs.writeFileSync(bookTextPath, '吾輩は猫である。');
  }

  afterEach(() => {
    vi.mocked(assertPythonHasMeCab).mockReset();
    vi.mocked(runBook).mockClear();
    vi.restoreAllMocks();
    fs.rmSync(path.dirname(bookTextPath), { recursive: true, force: true });
  });

  it('Test_runCli_PythonWithoutMeCabStopsBeforeAnyStep', async () => {
    writeBookText();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(assertPythonHasMeCab).mockImplementation(() => {
      throw new Error('Python cannot import MeCab');
    });

    await expect(runCli([bookTextPath, '--skip-extract'])).rejects.toThrow('Python cannot import MeCab');
    expect(runBook).not.toHaveBeenCalled();
  });

  it('Test_runCli_NoPythonStepSkipsTheMeCabCheck', async () => {
    writeBookText();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCli([bookTextPath, '--skip-extract', '--skip-rephrase']);
    expect(assertPythonHasMeCab).not.toHaveBeenCalled();
    expect(runBook).toHaveBeenCalledOnce();
  });
});
