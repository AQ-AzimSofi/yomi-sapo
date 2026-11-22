import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProgress,
  getProgressPath,
  loadProgress,
  resetChangedChunks,
  saveProgress,
  simpleHash,
  applyChunkChanges,
} from './progress';

const SETTINGS = { chunkSize: 5000, delaySeconds: 0, model: 'sonnet' };
const CHUNKS = ['<ruby>漢<rt>かん</rt></ruby>字', 'かな'];

function createSampleProgress() {
  return createProgress({
    bookName: 'book',
    directory: 'bookv2-furigana/book',
    sourceText: CHUNKS.join('\n\n'),
    chunking: { chunks: CHUNKS, boundaries: [{ start: 0, end: 10 }, { start: 10, end: 20 }] },
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
    expect(progress.chunks.items[1]).toEqual({
      index: 1, startChar: 10, endChar: 20, sourceHash: simpleHash('かな'), status: 'pending', attempts: 0,
    });
  });

  it('Test_createProgress_CountsCharactersWithoutRuby', () => {
    expect(createSampleProgress().source.totalCharacters).toBe('漢字\n\nかな'.length);
  });

  it('Test_createProgress_WritesVersion2', () => {
    expect(createSampleProgress().version).toBe(2);
  });
});

describe('applyChunkChanges', () => {
  it('Test_applyChunkChanges_CountsOnlyCompletedChunks', () => {
    const progress = applyChunkChanges(createSampleProgress(), new Map([[0, { status: 'completed' as const }], [1, { status: 'fallback' as const }]]));
    expect(progress.chunks.completed).toBe(1);
  });

  it('Test_applyChunkChanges_LeavesOtherChunksAndTheInputUnchanged', () => {
    const progress = createSampleProgress();
    const updated = applyChunkChanges(progress, new Map([[0, { status: 'completed' as const }]]));
    expect(updated.chunks.items[1]).toEqual(progress.chunks.items[1]);
    expect(progress.chunks.items[0].status).toBe('pending');
  });
});

describe('resetChangedChunks', () => {
  it('Test_resetChangedChunks_SavedChunkWithOtherSourceGoesBackToPending', () => {
    const progress = applyChunkChanges(createSampleProgress(), new Map([[1, { status: 'completed' as const, attempts: 1, completedAt: 'then' }]]));
    const { progress: resetProgress, resetIndexes } = resetChangedChunks(progress, [CHUNKS[0], 'ひらがな']);
    expect(resetIndexes).toEqual([1]);
    expect(resetProgress.chunks.items[1]).toEqual({
      index: 1, startChar: 10, endChar: 20, sourceHash: simpleHash('ひらがな'), status: 'pending', attempts: 0,
    });
  });

  it('Test_resetChangedChunks_MatchingChunksStay', () => {
    const progress = applyChunkChanges(createSampleProgress(), new Map([[0, { status: 'completed' as const }]]));
    expect(resetChangedChunks(progress, CHUNKS)).toEqual({ progress, resetIndexes: [] });
  });
});

describe('loadProgress', () => {
  const testDir = path.join(os.tmpdir(), 'progress-test');
  const progressPath = getProgressPath(testDir, 'book');

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('Test_loadProgress_MissingFile', () => {
    expect(loadProgress(progressPath)).toBeNull();
  });

  it('Test_loadProgress_ReadsWhatSaveProgressWrote', () => {
    const progress = createSampleProgress();
    saveProgress(progressPath, progress);
    expect(loadProgress(progressPath)).toEqual({ ...progress, lastUpdatedAt: expect.any(String) });
  });

  it('Test_loadProgress_UnreadableFileStopsTheRun', () => {
    fs.writeFileSync(progressPath, '{"version": 2, "chunks": {"ite');
    expect(() => loadProgress(progressPath)).toThrow('--reset');
  });

  it('Test_loadProgress_UnknownVersionStopsTheRun', () => {
    fs.writeFileSync(progressPath, JSON.stringify({ version: 3, chunks: { items: [] } }));
    expect(() => loadProgress(progressPath)).toThrow('unknown progress version 3');
  });

  it('Test_getProgressPath_NamesFileAfterBook', () => {
    expect(path.basename(progressPath)).toBe('book-rephrase-progress.json');
  });
});
