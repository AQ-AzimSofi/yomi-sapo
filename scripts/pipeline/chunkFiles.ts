import fs from 'node:fs';
import path from 'node:path';
import type { WriteFile } from '../shared/atomicFile';
import { getProgressPath } from './progress';

export type ChunkFileKind = 'rephrase' | 'furigana';

// The outputs used to grow by appending each chunk after this separator; rebuilt outputs keep the same bytes.
export const CHUNK_SEPARATOR = '\n\n';

export interface BookFiles {
  sourcePath: string;
  rawPath: string;
  furiganaPath: string;
  progressPath: string;
  chunksDir: string;
}

export function getBookFiles(sourceDir: string, bookName: string): BookFiles {
  return {
    sourcePath: path.join(sourceDir, `${bookName}.txt`),
    rawPath: path.join(sourceDir, `${bookName}-rephrase.txt`),
    furiganaPath: path.join(sourceDir, `${bookName}-rephrase-furigana.txt`),
    progressPath: getProgressPath(sourceDir, bookName),
    chunksDir: path.join(sourceDir, 'chunks'),
  };
}

export function getChunkPath(chunksDir: string, chunkIndex: number, kind: ChunkFileKind): string {
  return path.join(chunksDir, `${String(chunkIndex).padStart(4, '0')}.${kind}.txt`);
}

function joinChunkFiles(chunksDir: string, doneChunkIndexes: readonly number[], kind: ChunkFileKind): string {
  return doneChunkIndexes
    .map((chunkIndex) => fs.readFileSync(getChunkPath(chunksDir, chunkIndex, kind), 'utf-8'))
    .join(CHUNK_SEPARATOR);
}

function readFileOrEmpty(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
}

function writeIfChanged(filePath: string, content: string, writeFile: WriteFile): boolean {
  if (readFileOrEmpty(filePath) === content) return false;
  writeFile(filePath, content);
  return true;
}

/**
 * Rebuilds -rephrase.txt and -rephrase-furigana.txt from the chunk files in index order, so their
 * content never depends on the order chunks finished in or on how often a run was interrupted.
 * Returns whether the reader's file changed.
 */
export function rebuildOutputs(files: BookFiles, doneChunkIndexes: readonly number[], writeFile: WriteFile): boolean {
  writeIfChanged(files.rawPath, joinChunkFiles(files.chunksDir, doneChunkIndexes, 'rephrase'), writeFile);
  return writeIfChanged(files.furiganaPath, joinChunkFiles(files.chunksDir, doneChunkIndexes, 'furigana'), writeFile);
}
