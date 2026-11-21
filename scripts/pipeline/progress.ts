import * as fs from 'fs';
import * as path from 'path';
import { writeFileAtomic, type WriteFile } from '../shared/atomicFile';
import { stripRubyTags } from './chunking';

interface ProgressSource {
  fileName: string;
  directory: string;
  totalCharacters: number;
  hash: string;
}

interface ProgressSettings {
  chunkSize: number;
  delaySeconds: number;
  model: string;
}

/**
 * pending: nothing saved yet. completed: its chunk files hold the rephrase. fallback: the rephrase
 * failed and its chunk files hold the original lines, so the next run retries it.
 */
export type ChunkStatus = 'pending' | 'completed' | 'fallback';

export interface ChunkProgress {
  index: number;
  startChar: number;
  endChar: number;
  /** simpleHash of the chunk's source text; a resumed run redoes a chunk whose source no longer matches. */
  sourceHash: string;
  status: ChunkStatus;
  attempts: number;
  completedAt?: string;
  error?: string;
  /** Set while the chunk's furigana file holds its text without furigana; the next run adds it. */
  furiganaError?: string;
}

export interface ProgressFile {
  version: 2;
  source: ProgressSource;
  chunks: {
    total: number;
    completed: number;
    items: ChunkProgress[];
  };
  settings: ProgressSettings;
  startedAt: string;
  lastUpdatedAt: string;
}

export interface ChunkProgressV1 {
  index: number;
  startChar: number;
  endChar: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  completedAt?: string;
  error?: string;
}

/** Written before chunk files existed, when each chunk was appended to the outputs as it finished. */
export interface ProgressFileV1 {
  version: 1;
  source: ProgressSource;
  chunks: {
    total: number;
    completed: number;
    items: ChunkProgressV1[];
  };
  settings: ProgressSettings;
  startedAt: string;
  lastUpdatedAt: string;
}

export type StoredProgress = ProgressFile | ProgressFileV1;

export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function getProgressPath(sourceDir: string, bookName: string): string {
  return path.join(sourceDir, `${bookName}-rephrase-progress.json`);
}

function parseStoredProgress(content: string): StoredProgress {
  const parsed = JSON.parse(content) as Partial<StoredProgress>;
  if (parsed.version !== 1 && parsed.version !== 2) throw new Error(`unknown progress version ${parsed.version}`);
  if (!Array.isArray(parsed.chunks?.items)) throw new Error('no chunk list');
  return parsed as StoredProgress;
}

// A progress file that cannot be read stops the run: starting over silently would redo every finished chunk.
export function loadProgress(progressPath: string): StoredProgress | null {
  if (!fs.existsSync(progressPath)) return null;
  try {
    return parseStoredProgress(fs.readFileSync(progressPath, 'utf-8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${progressPath}: ${reason}. Fix the file, or start the book over with --reset.`, { cause: error });
  }
}

export function saveProgress(progressPath: string, progress: ProgressFile, writeFile: WriteFile = writeFileAtomic): void {
  const savedProgress = { ...progress, lastUpdatedAt: new Date().toISOString() };
  writeFile(progressPath, JSON.stringify(savedProgress, null, 2));
}

export function isChunkSaved(item: ChunkProgress): boolean {
  return item.status !== 'pending';
}

export function isChunkFinished(item: ChunkProgress): boolean {
  return item.status === 'completed' && item.furiganaError === undefined;
}

export function listSavedChunkIndexes(progress: ProgressFile): number[] {
  return progress.chunks.items.filter(isChunkSaved).map((item) => item.index);
}

export function countCompletedChunks(items: readonly ChunkProgress[]): number {
  return items.filter((item) => item.status === 'completed').length;
}

export function updateChunk(progress: ProgressFile, chunkIndex: number, changes: Partial<ChunkProgress>): ProgressFile {
  const items = progress.chunks.items.map((item) => (item.index === chunkIndex ? { ...item, ...changes } : item));
  return { ...progress, chunks: { ...progress.chunks, completed: countCompletedChunks(items), items } };
}

export interface NewProgress {
  bookName: string;
  directory: string;
  sourceText: string;
  chunking: { chunks: string[]; boundaries: { start: number; end: number }[] };
  settings: ProgressSettings;
}

export function createProgress({ bookName, directory, sourceText, chunking, settings }: NewProgress): ProgressFile {
  return {
    version: 2,
    source: {
      fileName: bookName,
      directory: directory,
      totalCharacters: stripRubyTags(sourceText).length,
      hash: simpleHash(sourceText),
    },
    chunks: {
      total: chunking.boundaries.length,
      completed: 0,
      items: chunking.boundaries.map((boundary, index) => ({
        index,
        startChar: boundary.start,
        endChar: boundary.end,
        sourceHash: simpleHash(chunking.chunks[index]),
        status: 'pending' as const,
        attempts: 0,
      })),
    },
    settings: {
      chunkSize: settings.chunkSize,
      delaySeconds: settings.delaySeconds,
      model: settings.model,
    },
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Chunks whose source no longer matches their stored hash (chunkText changed between runs) go
 * back to pending, so their old output is never kept for different text.
 */
export function resetChangedChunks(progress: ProgressFile, chunks: readonly string[]): { progress: ProgressFile; resetIndexes: number[] } {
  const resetIndexes = progress.chunks.items
    .filter((item) => isChunkSaved(item) && item.sourceHash !== simpleHash(chunks[item.index]))
    .map((item) => item.index);
  const items = progress.chunks.items.map((item): ChunkProgress => {
    const sourceHash = simpleHash(chunks[item.index]);
    if (!resetIndexes.includes(item.index)) return { ...item, sourceHash };
    return { index: item.index, startChar: item.startChar, endChar: item.endChar, sourceHash, status: 'pending', attempts: 0 };
  });
  const resetProgress = { ...progress, chunks: { ...progress.chunks, completed: countCompletedChunks(items), items } };
  return { progress: resetProgress, resetIndexes };
}
