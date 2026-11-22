import fs from 'node:fs';
import path from 'node:path';
import { isClaudeModel } from '../utils/claude-rephrase';
import { writeFileAtomic, type WriteFile } from '../shared/atomicFile';
import { createKeyPool } from '../shared/geminiKeyPool';
import { getBookFiles, getChunkPath, readFileOrEmpty, rebuildOutputs, type BookFiles } from './chunkFiles';
import { chunkText, stripRubyTags } from './chunking';
import { addFuriganaWithPython, type FuriganaResult } from './furigana';
import {
  createProgress,
  isChunkFinished,
  listSavedChunkIndexes,
  loadProgress,
  resetChangedChunks,
  saveProgress,
  simpleHash,
  updateChunk,
  type ChunkProgress,
  type ProgressFile,
  type ProgressFileV1,
} from './progress';
import { migrateV1Progress, type ChunkTexts } from './progressMigration';
import { createClaudeRephraser, createGeminiRephraser, sleep, type ChunkRephraser } from './rephraseChunk';
import { findReaderMismatches } from './rephraseFormat';
import type { SyncToDatabase, TextEntryTarget } from './textEntrySync';

export interface RephraseOptions {
  outputDir: string;
  chunkSize: number;
  delaySeconds: number;
  model: string;
  reset: boolean;
  dryRun: boolean;
}

export type CreateRephraser = (model: string) => ChunkRephraser;

export interface RephraseDeps {
  createRephraser: CreateRephraser;
  addFurigana: (readerText: string) => FuriganaResult;
  syncToDatabase: SyncToDatabase;
  writeFile: WriteFile;
}

interface BookLocation {
  bookName: string;
  sourceDir: string;
}

interface BookSource {
  bookName: string;
  files: BookFiles;
  sourceText: string;
}

interface RunStart {
  progress: ProgressFile;
  chunks: string[];
  isFreshStart: boolean;
  /** Chunk files to write before the first save: the earlier version's outputs split per chunk. */
  migratedChunkTexts: ChunkTexts[];
}

type RunPlan = { start: RunStart } | { problem: string };

interface ChunkRun {
  files: BookFiles;
  chunks: string[];
  rephraser: ChunkRephraser;
  deps: RephraseDeps;
  textEntry: TextEntryTarget;
  shouldStop: () => boolean;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function createRephraser(model: string): ChunkRephraser {
  return isClaudeModel(model) ? createClaudeRephraser(model) : createGeminiRephraser(model, () => createKeyPool());
}

/** The database sync depends on the run's --database-url, so the caller adds it. */
export const defaultRephraseDeps: Omit<RephraseDeps, 'syncToDatabase'> = {
  createRephraser,
  addFurigana: addFuriganaWithPython,
  writeFile: writeFileAtomic,
};

// ============================================================================
// Run Start: fresh, resumed, or moved over from the version 1 progress file
// ============================================================================

function planFreshStart({ bookName, sourceText }: BookSource, options: RephraseOptions): RunStart {
  const chunking = chunkText(sourceText, options.chunkSize);
  // The Claude subscription has no per-minute quota to wait out, so its chunks run back to back
  const delaySeconds = isClaudeModel(options.model) ? 0 : options.delaySeconds;
  const progress = createProgress({
    bookName,
    directory: `${options.outputDir}/${bookName}`,
    sourceText,
    chunking,
    settings: { chunkSize: options.chunkSize, delaySeconds, model: options.model },
  });
  return { progress, chunks: chunking.chunks, isFreshStart: true, migratedChunkTexts: [] };
}

function planMigration(legacy: ProgressFileV1, chunks: string[], files: BookFiles): RunPlan {
  const outputs = { rawText: readFileOrEmpty(files.rawPath), furiganaText: readFileOrEmpty(files.furiganaPath) };
  const result = migrateV1Progress(legacy, chunks, outputs);
  if ('problem' in result) return { problem: `This book's progress predates chunk files and cannot be moved over: ${result.problem}` };

  const { migrated } = result;
  console.log(`\nProgress predates chunk files: the earlier output splits into ${migrated.chunkTexts.length} chunk file(s)`);
  if (migrated.droppedChunkIndex !== undefined) {
    console.log(`Chunk ${migrated.droppedChunkIndex + 1} was only half saved when the earlier run stopped; it is redone`);
  }
  return { start: { progress: migrated.progress, chunks, isFreshStart: false, migratedChunkTexts: migrated.chunkTexts } };
}

function planRun(book: BookSource, options: RephraseOptions): RunPlan {
  const storedProgress = options.reset ? null : loadProgress(book.files.progressPath);
  if (!storedProgress) return { start: planFreshStart(book, options) };
  if (storedProgress.source.hash !== simpleHash(book.sourceText)) {
    return { problem: 'Source file has changed since last run.\nUse --reset to start fresh.' };
  }

  const { chunks } = chunkText(book.sourceText, storedProgress.settings.chunkSize);
  if (storedProgress.chunks.total !== chunks.length) {
    return { problem: `The progress file lists ${storedProgress.chunks.total} chunks, but the source now splits into ${chunks.length}.\nUse --reset to start fresh.` };
  }
  if (storedProgress.version === 1) return planMigration(storedProgress, chunks, book.files);

  const { progress, resetIndexes } = resetChangedChunks(storedProgress, chunks);
  if (resetIndexes.length > 0) {
    console.log(`\nChunk(s) ${resetIndexes.map((index) => index + 1).join(', ')} no longer match the source and are redone`);
  }
  return { start: { progress, chunks, isFreshStart: false, migratedChunkTexts: [] } };
}

function logRunPlan(start: RunStart, rephraser: ChunkRephraser, options: RephraseOptions): void {
  const { progress, chunks } = start;
  if (!start.isFreshStart) {
    console.log(`\nResuming from progress: ${progress.chunks.completed}/${progress.chunks.total} chunks done`);
    console.log(`Model: ${progress.settings.model} (the model this book started with; --reset starts over with --model)`);
    return;
  }

  console.log(`\nChunks: ${chunks.length} (target size: ${options.chunkSize} chars)`);
  if (isClaudeModel(options.model)) {
    console.log(`Rephraser: claude -p (no delay between chunks)`);
  } else {
    const keyCount = rephraser.keyCount;
    const effectiveDelay = Math.ceil(progress.settings.delaySeconds / keyCount);
    console.log(`API Keys: ${keyCount} (rotating for faster processing)`);
    console.log(`Delay: ${effectiveDelay}s (${formatDuration(effectiveDelay)}) between chunks (base: ${progress.settings.delaySeconds}s / ${keyCount} keys)`);
    console.log(`Estimated total time: ${formatDuration(chunks.length * effectiveDelay)}`);
  }
  console.log(`Model: ${options.model}`);
  console.log(`Furigana: enabled (adding after each chunk)`);
}

function printChunkPreview(chunks: readonly string[]): void {
  console.log('\n=== Dry Run - Chunk Preview ===');
  chunks.forEach((chunk, i) => {
    const stripped = stripRubyTags(chunk);
    const preview = stripped.slice(0, 50).replace(/\n/g, ' ');
    console.log(`\nChunk ${i + 1}/${chunks.length} (${stripped.length} chars):`);
    console.log(`  ${preview}...`);
  });
}

// A fresh start writes new chunk files, so an earlier run's output is kept aside rather than mixed in.
function setAsideEarlierOutput(outputPaths: string[]): void {
  outputPaths.filter((outputPath) => fs.existsSync(outputPath)).forEach((outputPath) => {
    const asidePath = `${outputPath}.bak`;
    fs.rmSync(asidePath, { recursive: true, force: true });
    fs.renameSync(outputPath, asidePath);
    console.log(`Starting fresh: moved the earlier output to ${path.basename(asidePath)}`);
  });
}

// Saving the progress file is the commit point: until then a rerun plans the same start again.
function commitRunStart(files: BookFiles, start: RunStart, writeFile: WriteFile): void {
  if (start.isFreshStart) setAsideEarlierOutput([files.rawPath, files.furiganaPath, files.chunksDir]);
  fs.mkdirSync(files.chunksDir, { recursive: true });
  start.migratedChunkTexts.forEach((chunkTexts, chunkIndex) => {
    writeFile(getChunkPath(files.chunksDir, chunkIndex, 'rephrase'), chunkTexts.rawText);
    writeFile(getChunkPath(files.chunksDir, chunkIndex, 'furigana'), chunkTexts.furiganaText);
  });
  saveProgress(files.progressPath, start.progress, writeFile);
}

// ============================================================================
// Chunk Processing
// ============================================================================

async function syncReaderFile(run: ChunkRun): Promise<void> {
  console.log(`  Syncing to database...`);
  const isSynced = await run.deps.syncToDatabase(run.textEntry);
  if (isSynced) {
    console.log(`  Database synced! Users can now read the updated content.`);
    return;
  }
  console.log(`  Warning: Database sync failed. File saved locally.`);
}

function needsOnlyFurigana(item: ChunkProgress): boolean {
  return item.status === 'completed' && item.furiganaError !== undefined;
}

function addFuriganaToChunkFile(run: ChunkRun, chunkIndex: number, readerText: string): string | undefined {
  console.log(`  Adding furigana...`);
  const furigana = run.deps.addFurigana(readerText);
  if (furigana.error) console.error(`    Furigana addition failed: ${furigana.error}`);
  findReaderMismatches(furigana.text).forEach((mismatch) => console.log(`    ! the reader reads this differently: ${mismatch}`));
  run.deps.writeFile(getChunkPath(run.files.chunksDir, chunkIndex, 'furigana'), furigana.text);
  return furigana.error;
}

async function rephraseToChunkFiles(run: ChunkRun, chunkIndex: number): Promise<Partial<ChunkProgress>> {
  const output = await run.rephraser.rephraseChunk(run.chunks[chunkIndex], chunkIndex);
  run.deps.writeFile(getChunkPath(run.files.chunksDir, chunkIndex, 'rephrase'), output.rawText);
  // Kept so a failed furigana step can be redone later without asking the model again.
  run.deps.writeFile(getChunkPath(run.files.chunksDir, chunkIndex, 'reader'), output.readerText);
  const furiganaError = addFuriganaToChunkFile(run, chunkIndex, output.readerText);
  return {
    status: output.isFallback ? 'fallback' : 'completed',
    attempts: output.attempts,
    completedAt: new Date().toISOString(),
    error: output.error,
    furiganaError,
  };
}

function redoFurigana(run: ChunkRun, chunkIndex: number): Partial<ChunkProgress> {
  const readerText = fs.readFileSync(getChunkPath(run.files.chunksDir, chunkIndex, 'reader'), 'utf-8');
  return { furiganaError: addFuriganaToChunkFile(run, chunkIndex, readerText) };
}

/**
 * Chunk files first, then the progress file, then the outputs rebuilt from the chunk files. A
 * kill between any two writes leaves either the chunk unsaved (it is redone) or saved with stale
 * outputs (the next run rebuilds them), so text is never repeated or reordered.
 */
async function processChunk(run: ChunkRun, progress: ProgressFile, chunkIndex: number): Promise<ProgressFile> {
  const item = progress.chunks.items[chunkIndex];
  console.log(`Processing chunk ${chunkIndex + 1}/${run.chunks.length} (${stripRubyTags(run.chunks[chunkIndex]).length} chars)...`);
  const changes = needsOnlyFurigana(item) ? redoFurigana(run, chunkIndex) : await rephraseToChunkFiles(run, chunkIndex);
  const updatedProgress = updateChunk(progress, chunkIndex, changes);
  saveProgress(run.files.progressPath, updatedProgress, run.deps.writeFile);
  rebuildOutputs(run.files, listSavedChunkIndexes(updatedProgress), run.deps.writeFile);
  await syncReaderFile(run);
  return updatedProgress;
}

async function processChunks(run: ChunkRun, startProgress: ProgressFile): Promise<ProgressFile> {
  const todoItems = startProgress.chunks.items.filter((item) => !isChunkFinished(item));
  const { delaySeconds, model } = startProgress.settings;
  const startTime = Date.now();
  console.log('\n=== Starting Processing ===\n');

  return todoItems.reduce(async (previous, item, todoPosition) => {
    const progress = await previous;
    if (run.shouldStop()) return progress;
    const updatedProgress = await processChunk(run, progress, item.index);

    const processedCount = todoPosition + 1;
    const remainingCount = todoItems.length - processedCount;
    const avgTime = (Date.now() - startTime) / 1000 / processedCount;
    console.log(`  Done! (${updatedProgress.chunks.completed}/${updatedProgress.chunks.total})`);
    console.log(`  ETA for remaining: ${formatDuration(remainingCount * Math.max(avgTime, delaySeconds))}`);

    // Wait between Gemini requests (delay divided by number of API keys); Claude and furigana-only redos need none
    const isWaitNeeded = !isClaudeModel(model) && !needsOnlyFurigana(item) && remainingCount > 0 && !run.shouldStop();
    if (!isWaitNeeded) return updatedProgress;
    const effectiveDelay = Math.ceil(delaySeconds / run.rephraser.keyCount);
    console.log(`\n  Waiting ${formatDuration(effectiveDelay)} before next chunk...`);
    console.log(`  (Press Ctrl+C to stop and save progress)\n`);
    await sleep(effectiveDelay * 1000);
    return updatedProgress;
  }, Promise.resolve(startProgress));
}

function printChunkList(label: string, items: readonly ChunkProgress[]): void {
  if (items.length === 0) return;
  console.log(`${label}: chunk ${items.map((item) => item.index + 1).join(', ')}`);
}

function printSummary(files: BookFiles, progress: ProgressFile): void {
  const { items } = progress.chunks;
  console.log('\n=== Rephrasing Complete ===');
  console.log(`Completed: ${progress.chunks.completed}/${progress.chunks.total} chunks`);
  printChunkList('Kept the original text (retried on the next run)', items.filter((item) => item.status === 'fallback'));
  printChunkList('Saved without furigana (added on the next run)', items.filter((item) => item.furiganaError !== undefined));
  printChunkList('Kept some paragraphs unrephrased', items.filter((item) => item.status === 'completed' && item.error !== undefined));
  console.log(`Output: ${files.furiganaPath}`);
  console.log(`Progress: ${files.progressPath}`);
}

// ============================================================================
// Batch Rephrase
// ============================================================================

/** Returns true once every chunk is rephrased with furigana; a rerun retries the rest. */
export async function batchRephrase(
  { bookName, sourceDir }: BookLocation,
  options: RephraseOptions,
  deps: RephraseDeps
): Promise<boolean> {
  const files = getBookFiles(sourceDir, bookName);
  if (!fs.existsSync(files.sourcePath)) {
    console.error(`Source file not found: ${files.sourcePath}`);
    return false;
  }

  const sourceText = fs.readFileSync(files.sourcePath, 'utf-8');
  console.log(`Source: ${files.sourcePath}`);
  console.log(`Total characters: ${stripRubyTags(sourceText).length.toLocaleString()} (excluding furigana)`);

  const plan = planRun({ bookName, files, sourceText }, options);
  if ('problem' in plan) {
    console.log(`\n${plan.problem}`);
    return false;
  }
  const { start } = plan;
  // A resumed run keeps the model it started with, whatever --model says now
  const rephraser = deps.createRephraser(start.progress.settings.model);
  logRunPlan(start, rephraser, options);

  if (options.dryRun) {
    printChunkPreview(start.chunks);
    return true;
  }

  commitRunStart(files, start, deps.writeFile);
  const textEntry = { fileName: `${bookName}-rephrase-furigana`, directory: `${options.outputDir}/${bookName}`, filePath: files.furiganaPath };
  const stopController = new AbortController();
  const run: ChunkRun = { files, chunks: start.chunks, rephraser, deps, textEntry, shouldStop: () => stopController.signal.aborted };

  // An earlier run stopped after saving a chunk but before rebuilding the outputs
  if (rebuildOutputs(files, listSavedChunkIndexes(start.progress), deps.writeFile)) {
    console.log('Rebuilt the outputs from the chunk files');
    await syncReaderFile(run);
  }

  const onInterrupt = () => {
    console.log('\n\nReceived SIGINT. Saving progress and exiting...');
    stopController.abort();
  };
  process.on('SIGINT', onInterrupt);
  try {
    const finalProgress = await processChunks(run, start.progress);
    printSummary(files, finalProgress);
    return finalProgress.chunks.items.every(isChunkFinished);
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}
