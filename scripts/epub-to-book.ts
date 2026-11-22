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
import { extractEpub, extractRubyRegistry } from './pipeline/epubExtraction';
import { uploadBookImages } from './pipeline/illustrationUpload';
import { batchRephrase, defaultRephraseDeps } from './pipeline/rephraseBook';
import { assertPythonHasMeCab } from './shared/python';
import { loadRepoEnv, REPO_ROOT } from './shared/repoPaths';
import { isEntryPoint } from './shared/entryPoint';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REPHRASE_MODEL = 'sonnet';

// ============================================================================
// Types
// ============================================================================

export interface CLIOptions {
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
// Main
// ============================================================================

const HELP_TEXT = `
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
`;

export function parseCliOptions(args: string[]): CLIOptions {
  const options: CLIOptions = {
    epubPath: path.resolve(args[0]),
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

  return options;
}

async function main(options: CLIOptions) {
  // Validate EPUB file
  if (!fs.existsSync(options.epubPath)) {
    console.error(`Error: EPUB file not found: ${options.epubPath}`);
    process.exit(1);
  }

  const needsPython = !options.skipExtract || !options.skipRephrase;
  if (needsPython) assertPythonHasMeCab();

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
    bookName = extractEpub(options.epubPath, options.outputDir, options.filter);
    if (!bookName) {
      console.error('Failed to extract EPUB');
      process.exit(1);
    }
  }

  const sourceDir = path.join(REPO_ROOT, 'public', options.outputDir, bookName);

  // Step 2: Extract Ruby Registry
  if (!options.skipExtract) {
    extractRubyRegistry(options.epubPath);
  }

  // Step 3: Upload illustrations before rephrasing, so chunks synced during step 4
  // are readable with their images straight away
  uploadBookImages(options.outputDir, bookName, options.dryRun);

  // Step 4: Batch Rephrase (unless skipped)
  if (!options.skipRephrase) {
    const success = await batchRephrase({ bookName, sourceDir }, options, defaultRephraseDeps);
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

async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(HELP_TEXT);
    return;
  }
  await main(parseCliOptions(args));
}

if (isEntryPoint(import.meta.url)) {
  loadRepoEnv();
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
