#!/usr/bin/env npx tsx
/**
 * Unified EPUB to Book Processing Script
 *
 * Complete pipeline for converting EPUB files to fully processed books:
 * 1. Extract text + images from EPUB
 * 2. Extract ruby registry from EPUB
 * 3. Upload illustrations + image metadata to the BookImages bucket (BOOK_IMAGES_BUCKET)
 * 4. Batch rephrase with Claude (claude -p, on the subscription) or the Gemini API
 * 5. Add furigana to rephrased text
 * 6. Sync to database after each chunk
 *
 * Usage:
 *   npx tsx scripts/epub-to-book.ts "path/to/book.epub" [options]
 *
 * Options:
 *   --output-dir <dir>   Output directory in public/ (default: bookv2-furigana)
 *   --chunk-size <n>     Target characters per chunk (default: 5000)
 *   --delay <n>          Seconds between Gemini chunks (default: 120; Claude runs without delay)
 *   --model <name>       Claude model (sonnet, opus) or a gemini-* model (default: sonnet)
 *   --skip-rephrase      Only extract, don't rephrase
 *   --skip-images        Don't extract images
 *   --filter <level>     Kanji filter: all, n3 (default: all)
 *   --reset              Start fresh, ignore existing progress
 *   --dry-run            Show plan without processing
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
import { isClaudeModel } from './utils/claude-rephrase';
import { chunkText, stripRubyTags } from './pipeline/chunking';
import { createProgress, getProgressPath, loadProgress, saveProgress, simpleHash } from './pipeline/progress';
import {
  createClaudeRephraser,
  createGeminiRephraser,
  sleep,
  type ChunkOutput,
  type ChunkRephraser,
} from './pipeline/rephraseChunk';
import { createKeyPool } from './shared/geminiKeyPool';

// Load environment variables
const envLocalPath = path.join(process.cwd(), '.env.local');
const envPath = path.join(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// ============================================================================
// Constants
// ============================================================================

// Use 'python' on Windows, 'python3' elsewhere
// On Windows, use full path if regular python command fails
const PYTHON_CMD = process.platform === 'win32'
  ? 'C:\\Users\\azimm\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
  : 'python3';

const DEFAULT_REPHRASE_MODEL = 'sonnet';

// ============================================================================
// Types
// ============================================================================

interface CLIOptions {
  epubPath: string;
  outputDir: string;
  chunkSize: number;
  delaySeconds: number;
  model: string;
  skipRephrase: boolean;
  skipExtract: boolean;
  skipImages: boolean;
  filter: 'all' | 'n3';
  reset: boolean;
  dryRun: boolean;
  apiUrl: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// ============================================================================
// EPUB Extraction
// ============================================================================

function extractEpub(epubPath: string, outputDir: string, filter: string, skipImages: boolean): string | null {
  console.log('\n=== Step 1: Extracting EPUB ===\n');

  const filterArg = filter === 'n3' ? '--filter n3' : '';
  const outputArg = `--output "${path.join(process.cwd(), 'public', outputDir)}"`;

  const cmd = `${PYTHON_CMD} scripts/core/epub-to-text-furigana.py "${epubPath}" ${filterArg} ${outputArg}`;

  console.log(`Running: ${cmd}\n`);

  try {
    const result = spawnSync(PYTHON_CMD, [
      'scripts/core/epub-to-text-furigana.py',
      epubPath,
      ...(filter === 'n3' ? ['--filter', 'n3'] : []),
      '--output', path.join(process.cwd(), 'public', outputDir),
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      console.error('EPUB extraction failed');
      return null;
    }

    // Find the created book directory
    const baseDir = path.join(process.cwd(), 'public', outputDir);
    const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    // Find most recently created directory (the one we just made)
    let newestDir = '';
    let newestTime = 0;

    for (const dir of dirs) {
      const dirPath = path.join(baseDir, dir);
      const stat = fs.statSync(dirPath);
      if (stat.mtimeMs > newestTime) {
        newestTime = stat.mtimeMs;
        newestDir = dir;
      }
    }

    if (newestDir) {
      console.log(`\nExtracted to: ${newestDir}`);
      return newestDir;
    }

    return null;
  } catch (error) {
    console.error('Error running epub extraction:', error);
    return null;
  }
}

// ============================================================================
// Ruby Registry Extraction
// ============================================================================

function extractRubyRegistry(epubPath: string, bookDir: string): boolean {
  console.log('\n=== Step 2: Extracting Ruby Registry ===\n');

  // Create temp directory and copy EPUB there for extract-ruby-smart.py
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const epubName = path.basename(epubPath);
  const tempEpubPath = path.join(tempDir, epubName);

  // Copy EPUB to temp
  fs.copyFileSync(epubPath, tempEpubPath);
  console.log(`Copied EPUB to: ${tempEpubPath}`);

  try {
    const result = spawnSync(PYTHON_CMD, [
      'scripts/core/extract-ruby-smart.py',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'inherit',
    });

    // Clean up temp file
    if (fs.existsSync(tempEpubPath)) {
      fs.unlinkSync(tempEpubPath);
    }

    if (result.status !== 0) {
      console.error('Ruby registry extraction failed');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error extracting ruby registry:', error);
    // Clean up on error
    if (fs.existsSync(tempEpubPath)) {
      fs.unlinkSync(tempEpubPath);
    }
    return false;
  }
}

// ============================================================================
// Illustration Upload
// ============================================================================

function runAwsS3(args: string[]): boolean {
  const result = spawnSync('aws', ['s3', ...args], { stdio: 'inherit' });
  if (result.status === 0) {
    return true;
  }
  console.error(`aws s3 ${args[0]} failed: ${result.error?.message ?? `exit code ${result.status}`}`);
  return false;
}

// public/<outputDir> is gitignored, so illustrations never reach the deployed app on
// their own; the reader loads them from this bucket through /api/book-assets.
// Exact paths rather than --include filters: the CLI matches filters against the
// unescaped absolute path, so a book name with [ or ] would make every filter miss.
function uploadBookImages(outputDir: string, bookName: string, isDryRun: boolean): void {
  console.log('\n=== Step 3: Uploading Illustrations ===\n');

  const bucket = process.env.BOOK_IMAGES_BUCKET;
  if (!bucket) {
    console.warn('BOOK_IMAGES_BUCKET is not set in .env.local; skipping. Illustrations will not show until uploaded.');
    return;
  }

  const bookPrefix = `${outputDir}/${bookName}`;
  const localBookDir = path.join(process.cwd(), 'public', bookPrefix);
  const imagesDir = path.join(localBookDir, 'images');
  const metadataPath = path.join(localBookDir, `${bookName}.json`);
  const modeFlag = isDryRun ? '--dryrun' : '--only-show-errors';

  const uploads = [
    { localPath: imagesDir, args: ['sync', imagesDir, `s3://${bucket}/${bookPrefix}/images/`] },
    { localPath: metadataPath, args: ['cp', metadataPath, `s3://${bucket}/${bookPrefix}/${bookName}.json`] },
  ].filter((upload) => fs.existsSync(upload.localPath));
  const failedUploads = uploads.filter((upload) => !runAwsS3([...upload.args, modeFlag]));

  if (failedUploads.length > 0) {
    console.error('Illustration upload failed; rerun the README "Book Illustrations" sync once fixed.');
    return;
  }
  console.log(`${isDryRun ? 'Would upload' : 'Uploaded'} illustrations to s3://${bucket}/${bookPrefix}/`);
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
    execSync(`${PYTHON_CMD} scripts/core/add-furigana-to-text.py "${tempInput}" -o "${tempOutput}"`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

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
  options: CLIOptions,
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

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Unified EPUB to Book Processing Script

Usage:
  npx tsx scripts/epub-to-book.ts <epub-file> [options]

Options:
  --output-dir <dir>   Output directory in public/ (default: bookv2-furigana)
  --chunk-size <n>     Target characters per chunk (default: 5000)
  --delay <n>          Seconds between Gemini chunks (default: 120; Claude runs without delay)
  --model <name>       Claude model (sonnet, opus) or a gemini-* model (default: sonnet)
  --skip-rephrase      Only extract, don't rephrase
  --skip-images        Don't extract images
  --filter <level>     Kanji filter: all, n3 (default: all)
  --reset              Start fresh, ignore existing progress
  --dry-run            Show plan without processing

Example:
  npx tsx scripts/epub-to-book.ts "my-book.epub"
  npx tsx scripts/epub-to-book.ts "my-book.epub" --delay 300 --filter n3
  npx tsx scripts/epub-to-book.ts "my-book.epub" --skip-rephrase
`);
    process.exit(0);
  }

  const options: CLIOptions = {
    epubPath: args[0],
    outputDir: 'bookv2-furigana',
    chunkSize: 5000,
    delaySeconds: 120, // Base delay (divided by number of API keys)
    model: DEFAULT_REPHRASE_MODEL,
    skipRephrase: false,
    skipExtract: false,
    skipImages: false,
    filter: 'all',
    reset: false,
    dryRun: false,
    apiUrl: 'http://localhost:3333',
  };

  // Parse options
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir':
        options.outputDir = args[++i];
        break;
      case '--chunk-size':
        options.chunkSize = parseInt(args[++i], 10);
        break;
      case '--delay':
        options.delaySeconds = parseInt(args[++i], 10);
        break;
      case '--model':
        options.model = args[++i];
        break;
      case '--skip-rephrase':
        options.skipRephrase = true;
        break;
      case '--skip-extract':
        options.skipExtract = true;
        break;
      case '--skip-images':
        options.skipImages = true;
        break;
      case '--filter':
        options.filter = args[++i] as 'all' | 'n3';
        break;
      case '--reset':
        options.reset = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--api-url':
        options.apiUrl = args[++i];
        break;
    }
  }

  // Validate EPUB file
  if (!fs.existsSync(options.epubPath)) {
    console.error(`Error: EPUB file not found: ${options.epubPath}`);
    process.exit(1);
  }

  console.log(`
============================================================
  EPUB to Book Processing Pipeline
============================================================
  EPUB: ${options.epubPath}
  Output: public/${options.outputDir}/
  Model: ${options.model}
  Filter: ${options.filter}
  Skip Rephrase: ${options.skipRephrase}
============================================================
`);

  // Step 1: Extract EPUB
  let bookName: string | null;
  if (options.skipExtract) {
    // Derive book name from epub filename
    bookName = path.basename(options.epubPath, path.extname(options.epubPath));
    console.log(`\n=== Skipping Extraction (--skip-extract) ===`);
    console.log(`Using existing book: ${bookName}\n`);
  } else {
    bookName = extractEpub(options.epubPath, options.outputDir, options.filter, options.skipImages);
    if (!bookName) {
      console.error('Failed to extract EPUB');
      process.exit(1);
    }
  }

  const sourceDir = path.join(process.cwd(), 'public', options.outputDir, bookName);

  // Step 2: Extract Ruby Registry
  if (!options.skipExtract) {
    extractRubyRegistry(options.epubPath, bookName);
  }

  // Step 3: Upload illustrations before rephrasing, so chunks synced during step 4
  // are readable with their images straight away
  uploadBookImages(options.outputDir, bookName, options.dryRun);

  // Step 4: Batch Rephrase (unless skipped)
  if (!options.skipRephrase) {
    const success = await batchRephrase({ bookName, sourceDir }, options, createRephraser);
    if (!success && !options.dryRun) {
      console.log('\nRephrasing incomplete. Run again to resume.');
    }
  } else {
    console.log('\n=== Skipping Rephrase (--skip-rephrase) ===');
    console.log(`Book extracted to: ${sourceDir}`);
  }

  console.log(`
============================================================
  Processing Complete!
============================================================
  Book: ${bookName}
  Location: public/${options.outputDir}/${bookName}/

  Files created:
    - ${bookName}.txt (extracted text)
    - ${bookName}.json (metadata)
    - ruby-registry.json (vocabulary)
    ${!options.skipRephrase ? `- ${bookName}-rephrase.txt (raw rephrase)
    - ${bookName}-rephrase-furigana.txt (final with furigana)` : ''}
============================================================
`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
