import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HELP_TEXT, parseCliOptions } from './epub-to-book';

describe('parseCliOptions', () => {
  it('Test_parseCliOptions_Defaults', () => {
    expect(parseCliOptions(['book.epub'])).toEqual({
      inputPath: path.resolve('book.epub'),
      outputDir: 'bookv2-furigana',
      chunkSize: 5000,
      delaySeconds: 120,
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
