import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic, type WriteFile } from '../shared/atomicFile';
import { splitParagraphs } from '../utils/claude-rephrase';
import { getBookFiles } from './chunkFiles';
import { chunkText, stripRubyTags } from './chunking';
import { createProgress, type ProgressFile, type ProgressFileV1 } from './progress';
import type { FuriganaResult } from './furigana';
import { batchRephrase, type RephraseDeps, type RephraseOptions } from './rephraseBook';
import { FALLBACK_ERROR, type ChunkOutput } from './rephraseChunk';
import type { TextEntryTarget } from './textEntrySync';

const BOOK_NAME = 'book';
const SOURCE_TEXT = [
  '<ruby>吾輩<rt>わがはい</rt></ruby>は猫である。',
  '名前はまだ無い。',
  'どこで生れたかとんと見当がつかぬ。',
  '何でも薄暗いじめじめした所で泣いていた事だけは記憶している。',
  '吾輩はここで始めて人間というものを見た。',
].join('\n\n');
const OPTIONS: RephraseOptions = {
  outputDir: 'bookv2-furigana',
  chunkSize: 30,
  delaySeconds: 0,
  model: 'sonnet',
  reset: false,
  dryRun: false,
};
const CHUNK_COUNT = chunkText(SOURCE_TEXT, OPTIONS.chunkSize).chunks.length;
// Two full runs per write the book makes, which a loaded machine can take well over the default 5s for.
const KILL_LOOP_TIMEOUT_MS = 60_000;

class KillSignal extends Error {}

type ReplyToChunk = (chunk: string, chunkIndex: number) => ChunkOutput;

function rephraseOf(chunk: string): string {
  return splitParagraphs(stripRubyTags(chunk)).map((line) => `< ${line}\n>> ${line}（やさしく）`).join('\n\n');
}

function fallbackOf(chunk: string): string {
  return splitParagraphs(stripRubyTags(chunk)).map((line) => `< ${line}\n>> ${line}`).join('\n\n');
}

const rephraseEveryChunk: ReplyToChunk = (chunk, chunkIndex) => ({
  rawText: `Chunk ${chunkIndex} reply\n${rephraseOf(chunk)}`,
  readerText: rephraseOf(chunk),
  attempts: 1,
  isFallback: false,
});

// Like the Python step on Windows: CRLF and ruby on every 猫.
function addFakeFurigana(text: string): FuriganaResult {
  return { text: text.replace(/\n/g, '\r\n').replace(/猫/g, '<ruby>猫<rt>ねこ</rt></ruby>') };
}

interface FakeDeps {
  deps: RephraseDeps;
  rephrasedChunkIndexes: number[];
  writtenPaths: string[];
}

function createFakeDeps(overrides: Partial<RephraseDeps> & { replyToChunk?: ReplyToChunk } = {}): FakeDeps {
  const rephrasedChunkIndexes: number[] = [];
  const writtenPaths: string[] = [];
  const replyToChunk = overrides.replyToChunk ?? rephraseEveryChunk;
  const writeFile = overrides.writeFile ?? writeFileAtomic;
  const deps: RephraseDeps = {
    createRephraser: () => ({
      keyCount: 1,
      rephraseChunk: async (chunk, { chunkIndex }) => {
        rephrasedChunkIndexes.push(chunkIndex);
        return replyToChunk(chunk, chunkIndex);
      },
    }),
    addFurigana: overrides.addFurigana ?? addFakeFurigana,
    syncToDatabase: overrides.syncToDatabase ?? (async () => true),
    stopSignal: overrides.stopSignal ?? new AbortController().signal,
    writeFile: (filePath, content) => {
      writtenPaths.push(filePath);
      writeFile(filePath, content);
    },
  };
  return { deps, rephrasedChunkIndexes, writtenPaths };
}

// Writes the first writeCount files, then dies part-way into the next one, leaving a torn temp file.
function createKillingWriter(writeCount: number): WriteFile {
  const completedWrites: string[] = [];
  return (filePath, content) => {
    if (completedWrites.length >= writeCount) {
      fs.writeFileSync(`${filePath}.killed.tmp`, content.slice(0, content.length / 2));
      throw new KillSignal(`killed before writing ${path.basename(filePath)}`);
    }
    writeFileAtomic(filePath, content);
    completedWrites.push(filePath);
  };
}

describe('batchRephrase', () => {
  const testRoot = path.join(os.tmpdir(), 'rephrase-book-test');
  const sourceDir = path.join(testRoot, BOOK_NAME);
  const files = getBookFiles(sourceDir, BOOK_NAME);
  const book = { bookName: BOOK_NAME, sourceDir };

  function writeSource(): void {
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(files.sourcePath, SOURCE_TEXT);
  }

  function readOutputs() {
    const chunkFiles = fs.readdirSync(files.chunksDir).filter((name) => !name.endsWith('.tmp'));
    return {
      rawText: fs.readFileSync(files.rawPath, 'utf-8'),
      furiganaText: fs.readFileSync(files.furiganaPath, 'utf-8'),
      chunkFiles: Object.fromEntries(chunkFiles.map((name) => [name, fs.readFileSync(path.join(files.chunksDir, name), 'utf-8')])),
    };
  }

  function readProgress(): ProgressFile {
    return JSON.parse(fs.readFileSync(files.progressPath, 'utf-8')) as ProgressFile;
  }

  async function runUninterrupted() {
    writeSource();
    await batchRephrase(book, OPTIONS, createFakeDeps().deps);
    return readOutputs();
  }

  // What the version 1 pipeline left when it was stopped in chunk 1 after appending its raw reply only.
  function writeV1StoppedInSecondChunk(): void {
    writeSource();
    const chunking = chunkText(SOURCE_TEXT, OPTIONS.chunkSize);
    const v2 = createProgress({
      bookName: BOOK_NAME, directory: `bookv2-furigana/${BOOK_NAME}`, sourceText: SOURCE_TEXT, chunking,
      settings: { chunkSize: OPTIONS.chunkSize, delaySeconds: 0, model: 'sonnet' },
    });
    const statuses = ['completed', 'processing', ...Array(CHUNK_COUNT - 2).fill('pending')];
    const v1: ProgressFileV1 = {
      ...v2,
      version: 1,
      chunks: {
        ...v2.chunks,
        completed: 1,
        items: v2.chunks.items.map(({ index, startChar, endChar, attempts }) => ({ index, startChar, endChar, attempts, status: statuses[index] })),
      },
    };
    const replies = chunking.chunks.map(rephraseEveryChunk);
    fs.writeFileSync(files.progressPath, JSON.stringify(v1));
    fs.writeFileSync(files.rawPath, replies.slice(0, 2).map((reply) => reply.rawText).join('\n\n'));
    fs.writeFileSync(files.furiganaPath, addFakeFurigana(replies[0].readerText).text);
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('Test_batchRephrase_SyncsTheReaderFileAfterEachChunk', async () => {
    writeSource();
    const syncedTargets: TextEntryTarget[] = [];
    const { deps } = createFakeDeps({
      syncToDatabase: async (target) => {
        syncedTargets.push(target);
        return true;
      },
    });

    await batchRephrase(book, OPTIONS, deps);

    const readerFileTarget = { directory: `bookv2-furigana/${BOOK_NAME}`, fileName: `${BOOK_NAME}-rephrase-furigana`, filePath: files.furiganaPath };
    expect(syncedTargets).toEqual(Array(CHUNK_COUNT).fill(readerFileTarget));
  });

  it('Test_batchRephrase_OutputsAreChunksInOrder', async () => {
    const outputs = await runUninterrupted();
    const { chunks } = chunkText(SOURCE_TEXT, OPTIONS.chunkSize);
    expect(CHUNK_COUNT).toBeGreaterThan(2);
    expect(outputs.furiganaText).toBe(chunks.map((chunk) => addFakeFurigana(rephraseOf(chunk)).text).join('\n\n'));
  });

  it('Test_batchRephrase_KillBetweenAnyTwoWritesResumesToIdenticalOutput', async () => {
    const reference = await runUninterrupted();
    writeSource();
    const { deps, writtenPaths } = createFakeDeps();
    await batchRephrase(book, OPTIONS, deps);
    expect(writtenPaths.length).toBeGreaterThan(CHUNK_COUNT * 4);

    for (const writeCount of writtenPaths.keys()) {
      writeSource();
      const killed = batchRephrase(book, OPTIONS, createFakeDeps({ writeFile: createKillingWriter(writeCount) }).deps);
      await expect(killed).rejects.toBeInstanceOf(KillSignal);
      expect(await batchRephrase(book, OPTIONS, createFakeDeps().deps)).toBe(true);
      expect(readOutputs(), `killed after ${writeCount} writes`).toEqual(reference);
    }
  }, KILL_LOOP_TIMEOUT_MS);

  it('Test_batchRephrase_ResumeSkipsSavedChunks', async () => {
    writeSource();
    const failOnSecondChunk = createFakeDeps({
      replyToChunk: (chunk, chunkIndex) => {
        if (chunkIndex === 1) throw new Error('claude -p exited with 1: usage limit');
        return rephraseEveryChunk(chunk, chunkIndex);
      },
    });
    await expect(batchRephrase(book, OPTIONS, failOnSecondChunk.deps)).rejects.toThrow('usage limit');
    const resumed = createFakeDeps();
    await batchRephrase(book, OPTIONS, resumed.deps);
    expect(resumed.rephrasedChunkIndexes).toEqual([...Array(CHUNK_COUNT).keys()].slice(1));
  });

  it('Test_batchRephrase_FallbackChunkIsMarkedAndRetriedNextRun', async () => {
    const reference = await runUninterrupted();
    writeSource();
    const withFallback = createFakeDeps({
      replyToChunk: (chunk, chunkIndex) => {
        if (chunkIndex !== 1) return rephraseEveryChunk(chunk, chunkIndex);
        return { rawText: fallbackOf(chunk), readerText: fallbackOf(chunk), attempts: 4, isFallback: true, error: FALLBACK_ERROR };
      },
    });
    expect(await batchRephrase(book, OPTIONS, withFallback.deps)).toBe(false);
    expect(readProgress().chunks.items.map((item) => item.status)).toEqual(['completed', 'fallback', ...Array(CHUNK_COUNT - 2).fill('completed')]);
    expect(console.log).toHaveBeenCalledWith('Kept the original text (retried on the next run): chunk 2');

    const retry = createFakeDeps();
    expect(await batchRephrase(book, OPTIONS, retry.deps)).toBe(true);
    expect(retry.rephrasedChunkIndexes).toEqual([1]);
    expect(readOutputs()).toEqual(reference);
  });

  it('Test_batchRephrase_FuriganaFailureIsRecordedAndRedoneWithoutTheModel', async () => {
    const reference = await runUninterrupted();
    writeSource();
    const failingFurigana = createFakeDeps({
      addFurigana: (text) => (text.includes('名前') ? { text, error: 'MeCab crashed' } : addFakeFurigana(text)),
    });
    expect(await batchRephrase(book, OPTIONS, failingFurigana.deps)).toBe(false);
    const failedChunk = readProgress().chunks.items.find((item) => item.furiganaError !== undefined);
    expect(failedChunk).toMatchObject({ status: 'completed', furiganaError: 'MeCab crashed' });

    const redo = createFakeDeps();
    expect(await batchRephrase(book, OPTIONS, redo.deps)).toBe(true);
    expect(redo.rephrasedChunkIndexes).toEqual([]);
    expect(readOutputs()).toEqual(reference);
  });

  it('Test_batchRephrase_StopAsAChunkFinishesKeepsItAndStartsNoOther', async () => {
    writeSource();
    const stopController = new AbortController();
    const { deps, rephrasedChunkIndexes } = createFakeDeps({
      stopSignal: stopController.signal,
      replyToChunk: (chunk, chunkIndex) => {
        stopController.abort();
        return rephraseEveryChunk(chunk, chunkIndex);
      },
    });
    expect(await batchRephrase(book, { ...OPTIONS, model: 'gemini-3.5-flash' }, deps)).toBe(false);
    expect(rephrasedChunkIndexes).toEqual([0]);
    expect(readProgress().chunks.items.map((item) => item.status)).toEqual(['completed', ...Array(CHUNK_COUNT - 1).fill('pending')]);
  });

  it('Test_batchRephrase_StopDuringAChunkDropsItAndKeepsTheSavedOnes', async () => {
    const reference = await runUninterrupted();
    writeSource();
    const stopController = new AbortController();
    const stopInSecondChunk = createFakeDeps({
      stopSignal: stopController.signal,
      replyToChunk: (chunk, chunkIndex) => {
        if (chunkIndex === 0) return rephraseEveryChunk(chunk, chunkIndex);
        stopController.abort();
        throw new Error('claude -p exited with null: killed by Ctrl+C');
      },
    });
    expect(await batchRephrase(book, OPTIONS, stopInSecondChunk.deps)).toBe(false);
    expect(readProgress().chunks.items.map((item) => item.status)).toEqual(['completed', ...Array(CHUNK_COUNT - 1).fill('pending')]);

    expect(await batchRephrase(book, OPTIONS, createFakeDeps().deps)).toBe(true);
    expect(readOutputs()).toEqual(reference);
  });

  it('Test_batchRephrase_DryRunWritesNothing', async () => {
    writeSource();
    expect(await batchRephrase(book, { ...OPTIONS, dryRun: true }, createFakeDeps().deps)).toBe(true);
    expect(fs.readdirSync(sourceDir)).toEqual([`${BOOK_NAME}.txt`]);
  });

  it('Test_batchRephrase_ChangedSourceRefusesToResume', async () => {
    await runUninterrupted();
    fs.appendFileSync(files.sourcePath, '\n\n続き。');
    expect(await batchRephrase(book, OPTIONS, createFakeDeps().deps)).toBe(false);
  });

  it('Test_batchRephrase_ResetSetsEarlierOutputAside', async () => {
    await runUninterrupted();
    await batchRephrase(book, { ...OPTIONS, reset: true }, createFakeDeps().deps);
    expect(fs.existsSync(`${files.chunksDir}.bak`)).toBe(true);
    expect(fs.existsSync(`${files.furiganaPath}.bak`)).toBe(true);
  });

  describe('a version 1 progress file', () => {
    it('Test_batchRephrase_V1ProgressResumesToIdenticalOutput', async () => {
      const reference = await runUninterrupted();
      writeV1StoppedInSecondChunk();
      const resumed = createFakeDeps();
      expect(await batchRephrase(book, OPTIONS, resumed.deps)).toBe(true);
      expect(resumed.rephrasedChunkIndexes).toEqual([...Array(CHUNK_COUNT).keys()].slice(1));
      expect(readOutputs().rawText).toBe(reference.rawText);
      expect(readOutputs().furiganaText).toBe(reference.furiganaText);
    });

    it('Test_batchRephrase_V1ProgressKilledWhileMovingOverResumesToIdenticalOutput', async () => {
      const reference = await runUninterrupted();
      writeV1StoppedInSecondChunk();
      const { deps, writtenPaths } = createFakeDeps();
      expect(await batchRephrase(book, OPTIONS, deps)).toBe(true);
      expect(writtenPaths.length).toBeGreaterThan(CHUNK_COUNT * 4);

      for (const writeCount of writtenPaths.keys()) {
        writeV1StoppedInSecondChunk();
        const killed = batchRephrase(book, OPTIONS, createFakeDeps({ writeFile: createKillingWriter(writeCount) }).deps);
        await expect(killed).rejects.toBeInstanceOf(KillSignal);
        await batchRephrase(book, OPTIONS, createFakeDeps().deps);
        const { rawText, furiganaText } = readOutputs();
        expect({ rawText, furiganaText }, `killed after ${writeCount} writes`).toEqual({ rawText: reference.rawText, furiganaText: reference.furiganaText });
      }
    }, KILL_LOOP_TIMEOUT_MS);

    it('Test_batchRephrase_V1ProgressThatCannotBeSplitIsLeftAlone', async () => {
      writeV1StoppedInSecondChunk();
      fs.writeFileSync(files.furiganaPath, '< 別の本。\r\n>> 別。');
      expect(await batchRephrase(book, OPTIONS, createFakeDeps().deps)).toBe(false);
      expect(JSON.parse(fs.readFileSync(files.progressPath, 'utf-8')).version).toBe(1);
      expect(fs.existsSync(files.chunksDir)).toBe(false);
    });
  });
});
