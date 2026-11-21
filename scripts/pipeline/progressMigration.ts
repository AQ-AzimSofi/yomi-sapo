import { listExpectedHeads, splitByChunkHeads } from './legacyOutputSplit';
import { countCompletedChunks, simpleHash, type ChunkProgress, type ChunkProgressV1, type ProgressFile, type ProgressFileV1 } from './progress';
import { FALLBACK_ERROR } from './rephraseChunk';

export interface ChunkTexts {
  rawText: string;
  furiganaText: string;
}

export interface MigratedProgress {
  progress: ProgressFile;
  /** The text of every chunk found in the old outputs, by chunk index, to save as chunk files. */
  chunkTexts: ChunkTexts[];
  /** The chunk the old run was stopped in when only -rephrase.txt got its text; it is redone. */
  droppedChunkIndex?: number;
}

export type MigrationResult = { migrated: MigratedProgress } | { problem: string };

function countLeadingCompleted(items: readonly ChunkProgressV1[]): number {
  const firstUnfinishedIndex = items.findIndex((item) => item.status !== 'completed');
  return firstUnfinishedIndex === -1 ? items.length : firstUnfinishedIndex;
}

// The old run went chunk by chunk, so completed chunks lead and only the next one can be mid-way.
function findOutOfOrderChunk(items: readonly ChunkProgressV1[], completedCount: number): ChunkProgressV1 | undefined {
  return items
    .slice(completedCount)
    .find((item, offset) => item.status !== 'pending' && !(offset === 0 && item.status === 'processing'));
}

// A run stopped mid-chunk may have appended that chunk before it could mark it completed.
function splitLegacyOutput(text: string, expectedHeadsByChunk: readonly string[][], chunkCounts: readonly number[]): string[] | undefined {
  return chunkCounts
    .map((chunkCount) => splitByChunkHeads(text, expectedHeadsByChunk.slice(0, chunkCount)))
    .find((chunkTexts) => chunkTexts !== undefined);
}

function describeUnsplittable(fileSuffix: string, completedCount: number): string {
  return `${fileSuffix} is not the ${completedCount} completed chunk(s) the progress file lists `
    + '(each < line must match the source in order), so it cannot be split into chunk files. '
    + '--reset starts the book over.';
}

function toChunkProgress(item: ChunkProgressV1, chunk: string, isFound: boolean): ChunkProgress {
  const base = { index: item.index, startChar: item.startChar, endChar: item.endChar, sourceHash: simpleHash(chunk) };
  if (!isFound) return { ...base, status: 'pending', attempts: 0 };
  return {
    ...base,
    status: item.error === FALLBACK_ERROR ? 'fallback' : 'completed',
    attempts: item.attempts,
    completedAt: item.completedAt,
    error: item.error,
  };
}

/**
 * Turns a version 1 progress file and the outputs it appended to into version 2 and one text per
 * chunk. A chunk counts as done only when both outputs hold it, so a chunk the old run was killed
 * in after writing only -rephrase.txt is redone, not kept twice. Gemini fallbacks become 'fallback'.
 */
export function migrateV1Progress(legacy: ProgressFileV1, chunks: readonly string[], outputs: ChunkTexts): MigrationResult {
  const { items } = legacy.chunks;
  if (items.length !== chunks.length) {
    return { problem: `the progress file lists ${items.length} chunks, but the source now splits into ${chunks.length}. --reset starts the book over.` };
  }
  const completedCount = countLeadingCompleted(items);
  const outOfOrderChunk = findOutOfOrderChunk(items, completedCount);
  if (outOfOrderChunk) {
    return { problem: `chunk ${outOfOrderChunk.index + 1} is ${outOfOrderChunk.status} after an unfinished chunk. --reset starts the book over.` };
  }

  const isInterrupted = items[completedCount]?.status === 'processing';
  const chunkCounts = isInterrupted ? [completedCount, completedCount + 1] : [completedCount];
  const expectedHeadsByChunk = chunks.map(listExpectedHeads);
  const rawChunkTexts = splitLegacyOutput(outputs.rawText, expectedHeadsByChunk, chunkCounts);
  if (!rawChunkTexts) return { problem: describeUnsplittable('-rephrase.txt', completedCount) };
  const furiganaChunkTexts = splitLegacyOutput(outputs.furiganaText, expectedHeadsByChunk, chunkCounts);
  if (!furiganaChunkTexts) return { problem: describeUnsplittable('-rephrase-furigana.txt', completedCount) };

  const foundCount = Math.min(rawChunkTexts.length, furiganaChunkTexts.length);
  const isChunkDropped = Math.max(rawChunkTexts.length, furiganaChunkTexts.length) > foundCount;
  const migratedItems = items.map((item, index) => toChunkProgress(item, chunks[index], index < foundCount));
  return {
    migrated: {
      progress: {
        ...legacy,
        version: 2,
        chunks: { total: items.length, completed: countCompletedChunks(migratedItems), items: migratedItems },
      },
      chunkTexts: rawChunkTexts.slice(0, foundCount).map((rawText, index) => ({ rawText, furiganaText: furiganaChunkTexts[index] })),
      droppedChunkIndex: isChunkDropped ? foundCount : undefined,
    },
  };
}
