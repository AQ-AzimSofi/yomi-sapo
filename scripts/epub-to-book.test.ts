import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCliOptions } from './epub-to-book';

describe('parseCliOptions', () => {
  it('Test_parseCliOptions_Defaults', () => {
    expect(parseCliOptions(['book.epub'])).toEqual({
      epubPath: path.resolve('book.epub'),
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
      apiUrl: 'http://localhost:3333',
    });
  });

  it('Test_parseCliOptions_EveryFlag', () => {
    const args = [
      'book.epub', '--output-dir', 'out', '--chunk-size', '300', '--delay', '5', '--model', 'gemini-3.5-flash',
      '--skip-rephrase', '--skip-extract', '--skip-images', '--filter', 'n3', '--reset', '--dry-run', '--api-url', 'http://127.0.0.1:9',
    ];
    expect(parseCliOptions(args)).toEqual({
      epubPath: path.resolve('book.epub'),
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
      apiUrl: 'http://127.0.0.1:9',
    });
  });
});
