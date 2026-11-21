import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgress, getProgressPath, loadProgress, saveProgress, simpleHash } from './progress';

const SETTINGS = { chunkSize: 5000, delaySeconds: 0, model: 'sonnet' };

function createSampleProgress() {
  return createProgress({
    bookName: 'book',
    directory: 'bookv2-furigana/book',
    sourceText: '<ruby>漢<rt>かん</rt></ruby>字\n\nかな',
    boundaries: [{ start: 0, end: 10 }, { start: 10, end: 20 }],
    settings: SETTINGS,
  });
}

describe('simpleHash', () => {
  // Progress files store this hash; a change to it would stop every unfinished book from resuming.
  it('Test_simpleHash_MatchesStoredHashes', () => {
    expect(simpleHash('吾輩は猫である。')).toBe('32eb53d9');
  });
});

describe('createProgress', () => {
  it('Test_createProgress_OnePendingItemPerBoundary', () => {
    const progress = createSampleProgress();
    expect(progress.chunks.total).toBe(2);
    expect(progress.chunks.items[1]).toEqual({ index: 1, startChar: 10, endChar: 20, status: 'pending', attempts: 0 });
  });

  it('Test_createProgress_CountsCharactersWithoutRuby', () => {
    expect(createSampleProgress().source.totalCharacters).toBe('漢字\n\nかな'.length);
  });
});

describe('loadProgress', () => {
  const testDir = path.join(os.tmpdir(), 'progress-test');

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('Test_loadProgress_MissingFile', () => {
    expect(loadProgress(getProgressPath(testDir, 'book'))).toBeNull();
  });

  it('Test_loadProgress_ReadsWhatSaveProgressWrote', () => {
    const progressPath = getProgressPath(testDir, 'book');
    const progress = createSampleProgress();
    saveProgress(progressPath, progress);
    expect(loadProgress(progressPath)).toEqual(progress);
  });

  it('Test_getProgressPath_NamesFileAfterBook', () => {
    expect(path.basename(getProgressPath(testDir, 'book'))).toBe('book-rephrase-progress.json');
  });
});
