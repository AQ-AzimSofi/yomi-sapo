import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_MODELS } from '../../lib/constants';
import { HELP_TEXT, parseCliOptions } from './ocr-pages';

const IMAGE_DIR = os.tmpdir();

describe('parseCliOptions', () => {
  it('Test_parseCliOptions_Defaults', () => {
    expect(parseCliOptions([IMAGE_DIR])).toEqual({
      imageDir: path.resolve(IMAGE_DIR),
      outDir: `${path.resolve(IMAGE_DIR)}-ocr`,
      model: AI_MODELS.GEMINI_3_5_FLASH,
      concurrency: undefined,
    });
  });

  it('Test_parseCliOptions_EveryFlag', () => {
    const options = parseCliOptions([IMAGE_DIR, '--out-dir', 'out', '--model', 'gemini-x', '--concurrency', '3']);
    expect(options).toMatchObject({ outDir: path.resolve('out'), model: 'gemini-x', concurrency: 3 });
  });

  it('Test_parseCliOptions_ConcurrencyMustBePositive', () => {
    expect(() => parseCliOptions([IMAGE_DIR, '--concurrency', '0'])).toThrow('--concurrency must be a whole number of at least 1, got "0".');
  });

  it('Test_parseCliOptions_MissingFolderThrows', () => {
    expect(() => parseCliOptions(['--model', 'gemini-x'])).toThrow('Pass the folder of page images');
  });
});

describe('HELP_TEXT', () => {
  it('Test_HELP_TEXT_ShowsTheSchemaDefaults', () => {
    expect(HELP_TEXT).toContain(`Gemini model (default: ${AI_MODELS.GEMINI_3_5_FLASH})`);
    expect(HELP_TEXT).toContain('Pages transcribed at once (default: one per free key)');
  });
});
