import * as fs from 'fs';
import * as path from 'path';
import { isClaudeModel } from '../utils/claude-rephrase';
import { chunkText, stripRubyTags } from './chunking';
import { createProgress, getProgressPath, loadProgress, saveProgress, simpleHash } from './progress';
import {
  createClaudeRephraser,
  createGeminiRephraser,
  sleep,
  type ChunkOutput,
  type ChunkRephraser,
} from './rephraseChunk';
import { createKeyPool } from '../shared/geminiKeyPool';
import { findReaderMismatches } from './rephraseFormat';
import { resolvePython, runPython } from '../shared/python';
import { CORE_SCRIPTS_DIR, REPO_ROOT } from '../shared/repoPaths';

export interface RephraseOptions {
  outputDir: string;
  chunkSize: number;
  delaySeconds: number;
  model: string;
  reset: boolean;
  dryRun: boolean;
  apiUrl: string;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

interface ChunkOutputTarget {
  rawPath: string;
  furiganaPath: string;
  sourceDir: string;
  apiUrl: string;
  fileName: string;
  directory: string;
}

// ============================================================================
// Database Sync
// ============================================================================

async function syncToDatabase(
  apiUrl: string,
  fileName: string,
  directory: string
): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/api/text-entries`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, directory }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`    Database sync failed: ${response.status} - ${errorText}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`    Database sync error:`, error);
    return false;
  }
}

// ============================================================================
// Furigana Addition
// ============================================================================

function addFuriganaToChunk(chunkText: string, outputDir: string): string {
  const tempInput = path.join(outputDir, 'temp-chunk.txt');
  const tempOutput = path.join(outputDir, 'temp-chunk-furigana.txt');

  fs.writeFileSync(tempInput, chunkText, 'utf-8');

  try {
    const furiganaRun = runPython(resolvePython(), [path.join(CORE_SCRIPTS_DIR, 'add-furigana-to-text.py'), tempInput, '-o', tempOutput], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (furiganaRun.status !== 0) {
      throw furiganaRun.error ?? new Error(`add-furigana-to-text.py exited with ${furiganaRun.status}: ${furiganaRun.stderr}`);
    }

    const result = fs.readFileSync(tempOutput, 'utf-8');

    fs.unlinkSync(tempInput);
    fs.unlinkSync(tempOutput);

    return result;
  } catch (error) {
    console.error(`    Furigana addition failed:`, error);
    fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    return chunkText;
  }
}

// ============================================================================
// Batch Rephrase Processing
// ============================================================================

// Chunks are appended, so a fresh start on top of an earlier run's output would repeat its passages.
function setAsideEarlierOutput(outputPaths: string[]): void {
  outputPaths.filter((outputPath) => fs.existsSync(outputPath)).forEach((outputPath) => {
    const asidePath = `${outputPath}.bak`;
    fs.renameSync(outputPath, asidePath);
    console.log(`Starting fresh: moved the earlier output to ${path.basename(asidePath)}`);
  });
}

async function saveChunkOutput(target: ChunkOutputTarget, output: ChunkOutput): Promise<void> {
  const rawSeparator = fs.existsSync(target.rawPath) ? '\n\n' : '';
  fs.appendFileSync(target.rawPath, rawSeparator + output.rawText, 'utf-8');

  console.log(`  Adding furigana...`);
  const withFurigana = addFuriganaToChunk(output.readerText, target.sourceDir);
  findReaderMismatches(withFurigana).forEach((mismatch) => console.log(`    ! the reader reads this differently: ${mismatch}`));
  const furiganaSeparator = fs.existsSync(target.furiganaPath) ? '\n\n' : '';
  fs.appendFileSync(target.furiganaPath, furiganaSeparator + withFurigana, 'utf-8');

  console.log(`  Syncing to database...`);
  const synced = await syncToDatabase(target.apiUrl, target.fileName, target.directory);
  if (synced) {
    console.log(`  Database synced! Users can now read the updated content.`);
    return;
  }
  console.log(`  Warning: Database sync failed. File saved locally.`);
}

interface BookLocation {
  bookName: string;
  sourceDir: string;
}

export type CreateRephraser = (model: string) => ChunkRephraser;

export function createRephraser(model: string): ChunkRephraser {
  return isClaudeModel(model) ? createClaudeRephraser(model) : createGeminiRephraser(model, () => createKeyPool());
}

export async function batchRephrase(
  { bookName, sourceDir }: BookLocation,
  options: RephraseOptions,
  createChunkRephraser: CreateRephraser
): Promise<boolean> {
  console.log('\n=== Step 4: Batch Rephrasing ===\n');

  const sourcePath = path.join(sourceDir, `${bookName}.txt`);
  const outputPath = path.join(sourceDir, `${bookName}-rephrase.txt`);
  const outputPathFurigana = path.join(sourceDir, `${bookName}-rephrase-furigana.txt`);
  const progressPath = getProgressPath(sourceDir, bookName);

  if (!fs.existsSync(sourcePath)) {
    console.error(`Source file not found: ${sourcePath}`);
    return false;
  }

  const sourceText = fs.readFileSync(sourcePath, 'utf-8');
  const strippedLength = stripRubyTags(sourceText).length;
  console.log(`Source: ${sourcePath}`);
  console.log(`Total characters: ${strippedLength.toLocaleString()} (excluding furigana)`);

  let progress = options.reset ? null : loadProgress(progressPath);
  const isFreshStart = !progress;
  let chunks: string[];
  // A resumed run keeps the model it started with, whatever --model says now
  const rephraser = createChunkRephraser(progress ? progress.settings.model : options.model);

  if (progress) {
    const currentHash = simpleHash(sourceText);
    if (progress.source.hash !== currentHash) {
      console.log('\nSource file has changed since last run.');
      console.log('Use --reset to start fresh.');
      return false;
    }

    console.log(`\nResuming from progress: ${progress.chunks.completed}/${progress.chunks.total} chunks done`);
    console.log(`Model: ${progress.settings.model} (the model this book started with; --reset starts over with --model)`);
    const result = chunkText(sourceText, progress.settings.chunkSize);
    chunks = result.chunks;
  } else {
    const result = chunkText(sourceText, options.chunkSize);
    chunks = result.chunks;

    const usesClaude = isClaudeModel(options.model);
    // The Claude subscription has no per-minute quota to wait out, so its chunks run back to back
    const delaySeconds = usesClaude ? 0 : options.delaySeconds;

    console.log(`\nChunks: ${chunks.length} (target size: ${options.chunkSize} chars)`);
    if (usesClaude) {
      console.log(`Rephraser: claude -p (no delay between chunks)`);
    } else {
      const keyCount = rephraser.keyCount;
      const effectiveDelay = Math.ceil(delaySeconds / keyCount);
      console.log(`API Keys: ${keyCount} (rotating for faster processing)`);
      console.log(`Delay: ${effectiveDelay}s (${formatDuration(effectiveDelay)}) between chunks (base: ${delaySeconds}s / ${keyCount} keys)`);
      console.log(`Estimated total time: ${formatDuration(chunks.length * effectiveDelay)}`);
    }
    console.log(`Model: ${options.model}`);
    console.log(`Database sync: ${options.apiUrl}`);
    console.log(`Furigana: enabled (adding after each chunk)`);

    progress = createProgress({
      bookName,
      directory: `${options.outputDir}/${bookName}`,
      sourceText,
      boundaries: result.boundaries,
      settings: { chunkSize: options.chunkSize, delaySeconds, model: options.model },
    });
  }

  if (options.dryRun) {
    console.log('\n=== Dry Run - Chunk Preview ===');
    chunks.forEach((chunk, i) => {
      const stripped = stripRubyTags(chunk);
      const preview = stripped.slice(0, 50).replace(/\n/g, ' ');
      console.log(`\nChunk ${i + 1}/${chunks.length} (${stripped.length} chars):`);
      console.log(`  ${preview}...`);
    });
    return true;
  }

  if (isFreshStart) setAsideEarlierOutput([outputPath, outputPathFurigana]);

  // Setup graceful shutdown
  let shouldStop = false;
  process.on('SIGINT', () => {
    console.log('\n\nReceived SIGINT. Saving progress and exiting...');
    shouldStop = true;
  });

  console.log('\n=== Starting Processing ===\n');

  const outputTarget: ChunkOutputTarget = {
    rawPath: outputPath,
    furiganaPath: outputPathFurigana,
    sourceDir,
    apiUrl: options.apiUrl,
    fileName: `${bookName}-rephrase-furigana`,
    directory: `${options.outputDir}/${bookName}`,
  };
  const usesClaudeForBook = isClaudeModel(progress.settings.model);
  const startTime = Date.now();
  let processedCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (shouldStop) break;

    const chunkProgress = progress.chunks.items[i];

    if (chunkProgress.status === 'completed') {
      continue;
    }

    const chunk = chunks[i];
    const chunkStripped = stripRubyTags(chunk);

    console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunkStripped.length} chars)...`);

    chunkProgress.status = 'processing';
    saveProgress(progressPath, progress);

    const output = await rephraser.rephraseChunk(chunk, i);
    chunkProgress.status = 'completed';
    chunkProgress.completedAt = new Date().toISOString();
    chunkProgress.attempts = output.attempts;
    chunkProgress.error = output.error;
    progress.chunks.completed++;

    await saveChunkOutput(outputTarget, output);
    processedCount++;

    const elapsed = (Date.now() - startTime) / 1000;
    const avgTime = elapsed / processedCount;
    const remaining = chunks.length - progress.chunks.completed;
    const eta = remaining * Math.max(avgTime, progress.settings.delaySeconds);

    console.log(`  Done! (${progress.chunks.completed}/${chunks.length})`);
    console.log(`  ETA for remaining: ${formatDuration(eta)}`);

    saveProgress(progressPath, progress);
    if (usesClaudeForBook) continue;

    // Wait before next chunk (delay divided by number of API keys)
    if (i < chunks.length - 1 && !shouldStop) {
      const pendingCount = progress.chunks.items.filter(c => c.status === 'pending').length;
      if (pendingCount > 0) {
        const effectiveDelay = Math.ceil(progress.settings.delaySeconds / rephraser.keyCount);
        console.log(`\n  Waiting ${formatDuration(effectiveDelay)} before next chunk...`);
        console.log(`  (Press Ctrl+C to stop and save progress)\n`);
        await sleep(effectiveDelay * 1000);
      }
    }
  }

  // Final summary
  console.log('\n=== Rephrasing Complete ===');
  console.log(`Completed: ${progress.chunks.completed}/${progress.chunks.total} chunks`);

  const failed = progress.chunks.items.filter(c => c.status === 'failed').length;
  if (failed > 0) {
    console.log(`Failed: ${failed} chunks`);
  }

  console.log(`Output: ${outputPathFurigana}`);
  console.log(`Progress: ${progressPath}`);

  return progress.chunks.completed === progress.chunks.total;
}
