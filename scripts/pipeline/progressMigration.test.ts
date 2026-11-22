import { describe, expect, it } from 'vitest';
import { GEMINI_CHUNKS, GEMINI_READER_CHUNKS, GEMINI_REPLIES } from './fixtures/geminiV1Book';
import { simpleHash, type ChunkProgressV1, type ProgressFileV1 } from './progress';
import { migrateV1Progress, type MigrationResult } from './progressMigration';
import { FALLBACK_ERROR } from './rephraseChunk';

const CHUNKS = ['一行目。\n二行目。', '三行目。', '四行目。'];

function rephraseOf(chunk: string): string {
  return chunk.split('\n').map((line) => `< ${line}\n>> ${line}（やさしく）`).join('\n\n');
}

// The furigana step on Windows wrote CRLF inside a chunk; the pipeline appended chunks after '\n\n'.
function furiganaOf(chunk: string): string {
  return rephraseOf(chunk).replace(/\n/g, '\r\n');
}

function appendedOutputs(chunkCount: { raw: number; furigana: number }) {
  return {
    rawText: CHUNKS.slice(0, chunkCount.raw).map(rephraseOf).join('\n\n'),
    furiganaText: CHUNKS.slice(0, chunkCount.furigana).map(furiganaOf).join('\n\n'),
  };
}

function v1Progress(statuses: ChunkProgressV1['status'][], errors: (string | undefined)[] = []): ProgressFileV1 {
  return {
    version: 1,
    source: { fileName: 'book', directory: 'bookv2-furigana/book', totalCharacters: 20, hash: 'abc' },
    chunks: {
      total: statuses.length,
      completed: statuses.filter((status) => status === 'completed').length,
      items: statuses.map((status, index) => ({
        index, startChar: index * 10, endChar: index * 10 + 10, status, attempts: 1, completedAt: 'then', error: errors[index],
      })),
    },
    settings: { chunkSize: 5000, delaySeconds: 0, model: 'sonnet' },
    startedAt: 'start',
    lastUpdatedAt: 'last',
  };
}

function migrated(result: MigrationResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result.migrated;
}

describe('migrateV1Progress', () => {
  it('Test_migrateV1Progress_SplitsCompletedChunksIntoChunkTexts', () => {
    const result = migrated(migrateV1Progress(v1Progress(['completed', 'completed', 'pending']), CHUNKS, appendedOutputs({ raw: 2, furigana: 2 })));
    expect(result.chunkTexts).toEqual([
      { rawText: rephraseOf(CHUNKS[0]), furiganaText: furiganaOf(CHUNKS[0]) },
      { rawText: rephraseOf(CHUNKS[1]), furiganaText: furiganaOf(CHUNKS[1]) },
    ]);
    expect(result.shouldSetAsideRawOutput).toBe(false);
  });

  it('Test_migrateV1Progress_GeminiBookStoppedMidChunkMovesOver', () => {
    const outputs = { rawText: GEMINI_REPLIES.join('\n\n'), furiganaText: GEMINI_READER_CHUNKS.join('\n\n') };
    const result = migrated(migrateV1Progress(v1Progress(['completed', 'completed', 'completed', 'processing']), GEMINI_CHUNKS, outputs));
    expect(result.progress.chunks.items.map((item) => item.status)).toEqual(['completed', 'completed', 'completed', 'pending']);
    expect(result.chunkTexts.map((chunkTexts) => chunkTexts.furiganaText)).toEqual(GEMINI_READER_CHUNKS);
  });

  it('Test_migrateV1Progress_RepliesThatDoNotSplitAreSetAside', () => {
    const outputs = { rawText: GEMINI_REPLIES.join('\n\n'), furiganaText: GEMINI_READER_CHUNKS.join('\n\n') };
    const result = migrated(migrateV1Progress(v1Progress(['completed', 'completed', 'completed', 'pending']), GEMINI_CHUNKS, outputs));
    expect(result.shouldSetAsideRawOutput).toBe(true);
    expect(result.chunkTexts.map((chunkTexts) => chunkTexts.rawText)).toEqual(['', '', '']);
  });

  it('Test_migrateV1Progress_WritesVersion2WithChunkHashes', () => {
    const { progress } = migrated(migrateV1Progress(v1Progress(['completed', 'pending', 'pending']), CHUNKS, appendedOutputs({ raw: 1, furigana: 1 })));
    expect(progress.version).toBe(2);
    expect(progress.chunks.items.map((item) => item.sourceHash)).toEqual(CHUNKS.map(simpleHash));
    expect(progress.chunks.items.map((item) => item.status)).toEqual(['completed', 'pending', 'pending']);
  });

  it('Test_migrateV1Progress_ChunkStoppedBeforeAnyWriteIsRedone', () => {
    const result = migrated(migrateV1Progress(v1Progress(['completed', 'processing', 'pending']), CHUNKS, appendedOutputs({ raw: 1, furigana: 1 })));
    expect(result.progress.chunks.items[1].status).toBe('pending');
    expect(result.droppedChunkIndex).toBeUndefined();
  });

  it('Test_migrateV1Progress_ChunkStoppedAfterBothWritesIsKept', () => {
    const result = migrated(migrateV1Progress(v1Progress(['completed', 'processing', 'pending']), CHUNKS, appendedOutputs({ raw: 2, furigana: 2 })));
    expect(result.progress.chunks.items[1].status).toBe('completed');
    expect(result.chunkTexts).toHaveLength(2);
  });

  it('Test_migrateV1Progress_ChunkInRawOutputOnlyIsDroppedAndRedone', () => {
    const result = migrated(migrateV1Progress(v1Progress(['completed', 'processing', 'pending']), CHUNKS, appendedOutputs({ raw: 2, furigana: 1 })));
    expect(result.droppedChunkIndex).toBe(1);
    expect(result.chunkTexts).toEqual([{ rawText: rephraseOf(CHUNKS[0]), furiganaText: furiganaOf(CHUNKS[0]) }]);
    expect(result.progress.chunks.items[1].status).toBe('pending');
  });

  it('Test_migrateV1Progress_GeminiFallbackBecomesFallback', () => {
    const legacy = v1Progress(['completed', 'completed', 'completed'], [undefined, FALLBACK_ERROR]);
    const { progress } = migrated(migrateV1Progress(legacy, CHUNKS, appendedOutputs({ raw: 3, furigana: 3 })));
    expect(progress.chunks.items.map((item) => item.status)).toEqual(['completed', 'fallback', 'completed']);
    expect(progress.chunks.completed).toBe(2);
  });

  it('Test_migrateV1Progress_ReaderFileThatDoesNotMatchIsAProblem', () => {
    const outputs = { ...appendedOutputs({ raw: 1, furigana: 1 }), furiganaText: '< 別の行。\r\n>> 別。' };
    const result = migrateV1Progress(v1Progress(['completed', 'pending', 'pending']), CHUNKS, outputs);
    expect(result).toEqual({ problem: expect.stringContaining('-rephrase-furigana.txt is not the 1 completed chunk(s)') });
  });

  it('Test_migrateV1Progress_CompletedAfterUnfinishedIsAProblem', () => {
    const result = migrateV1Progress(v1Progress(['completed', 'pending', 'completed']), CHUNKS, appendedOutputs({ raw: 1, furigana: 1 }));
    expect(result).toEqual({ problem: expect.stringContaining('chunk 3 is completed after an unfinished chunk') });
  });

  it('Test_migrateV1Progress_ChangedChunkCountIsAProblem', () => {
    const result = migrateV1Progress(v1Progress(['completed', 'pending']), CHUNKS, appendedOutputs({ raw: 1, furigana: 1 }));
    expect(result).toEqual({ problem: expect.stringContaining('lists 2 chunks, but the source now splits into 3') });
  });
});
