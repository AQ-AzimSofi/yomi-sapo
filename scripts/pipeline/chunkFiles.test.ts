import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from '../shared/atomicFile';
import { getBookFiles, getChunkPath, rebuildOutputs } from './chunkFiles';

describe('getChunkPath', () => {
  it('Test_getChunkPath_PadsIndexToFourDigits', () => {
    expect(path.basename(getChunkPath('chunks', 7, 'furigana'))).toBe('0007.furigana.txt');
  });
});

describe('rebuildOutputs', () => {
  const testDir = path.join(os.tmpdir(), 'chunk-files-test');
  const files = getBookFiles(testDir, 'book');

  function writeChunk(chunkIndex: number, rawText: string, furiganaText: string) {
    fs.writeFileSync(getChunkPath(files.chunksDir, chunkIndex, 'rephrase'), rawText);
    fs.writeFileSync(getChunkPath(files.chunksDir, chunkIndex, 'furigana'), furiganaText);
  }

  beforeEach(() => fs.mkdirSync(files.chunksDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('Test_rebuildOutputs_JoinsDoneChunksInIndexOrder', () => {
    writeChunk(0, 'r0', 'f0');
    writeChunk(1, 'r1', 'f1');
    writeChunk(2, 'r2', 'f2');
    rebuildOutputs(files, [0, 2], writeFileAtomic);
    expect(fs.readFileSync(files.rawPath, 'utf-8')).toBe('r0\n\nr2');
    expect(fs.readFileSync(files.furiganaPath, 'utf-8')).toBe('f0\n\nf2');
  });

  it('Test_rebuildOutputs_ReportsReaderFileChange', () => {
    writeChunk(0, 'r0', 'f0');
    expect(rebuildOutputs(files, [0], writeFileAtomic)).toBe(true);
    expect(rebuildOutputs(files, [0], writeFileAtomic)).toBe(false);
  });

  it('Test_rebuildOutputs_LeavesUnchangedFilesAlone', () => {
    writeChunk(0, 'r0', 'f0');
    rebuildOutputs(files, [0], writeFileAtomic);
    const writeFile = vi.fn();
    rebuildOutputs(files, [0], writeFile);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('Test_rebuildOutputs_NoDoneChunkCreatesNoFile', () => {
    rebuildOutputs(files, [], writeFileAtomic);
    expect(fs.existsSync(files.furiganaPath)).toBe(false);
  });
});
