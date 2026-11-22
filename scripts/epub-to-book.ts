#!/usr/bin/env npx tsx
/**
 * The book pipeline: args -> a book source -> the steps (scripts/pipeline/).
 *
 * Sources (scripts/pipeline/bookSources.ts):
 * - an EPUB: text, images and metadata extracted into public/<output-dir>/<book>/
 * - an ocr-pages.ts output folder: its joined text gets furigana, its figures are copied
 * - --skip-extract: the text already in public/<output-dir>/<book>/<book>.txt
 *
 * Steps (scripts/pipeline/pipelineSteps.ts):
 * 1. Ruby registry from the EPUB
 * 2. Upload illustrations + image metadata to the BookImages bucket (BOOK_IMAGES_BUCKET)
 * 3. Rephrase chunk by chunk with Claude (claude -p, on the subscription) or the Gemini API,
 *    add furigana, and sync the reader's file to the local database after each chunk
 *
 * Usage: npx tsx scripts/epub-to-book.ts <book.epub | ocr folder> [options], options in HELP_TEXT below.
 */

import * as fs from 'fs';
import * as path from 'path';
import { selectBookSource, type BookSource } from './pipeline/bookSources';
import { PIPELINE_STEPS } from './pipeline/pipelineSteps';
import { runSteps, type PipelineOptions, type PreparedBook } from './pipeline/runner';
import { assertPythonHasMeCab } from './shared/python';
import { loadRepoEnv, REPO_ROOT } from './shared/repoPaths';
import { isEntryPoint } from './shared/entryPoint';

const DEFAULT_REPHRASE_MODEL = 'sonnet';

// ============================================================================
// Main
// ============================================================================

const HELP_TEXT = `
Book pipeline: EPUB or OCR text -> furigana, rephrase, local database

Usage:
  npx tsx scripts/epub-to-book.ts <epub-file> [options]
  npx tsx scripts/epub-to-book.ts <ocr-pages.ts output folder> [options]
  npx tsx scripts/epub-to-book.ts <any path named after the book> --skip-extract [options]

Options:
  --output-dir <dir>     Output directory in public/ (default: bookv2-furigana)
  --chunk-size <n>       Target characters per chunk (default: 5000)
  --delay <n>            Seconds between Gemini chunks (default: 120; Claude runs without delay)
  --model <name>         Claude model (sonnet, opus) or a gemini-* model (default: sonnet)
  --skip-extract         Use public/<output-dir>/<book>/<book>.txt as it is; the input path only names the book
  --skip-rephrase        Only extract, don't rephrase
  --skip-images          Has no effect: the EPUB extractor always writes the images
  --filter <level>       Kanji filter: all, n3 (default: all)
  --reset                Start fresh, ignore existing progress
  --dry-run              Show plan without processing
  --database-url <url>   Local database each chunk is synced to (default: DATABASE_URL); other hosts are refused

Example:
  npx tsx scripts/epub-to-book.ts "my-book.epub"
  npx tsx scripts/epub-to-book.ts "my-book.epub" --delay 300 --filter n3
  npx tsx scripts/epub-to-book.ts "my-book.epub" --skip-rephrase
  npx tsx scripts/epub-to-book.ts "temp/books/my-book-ocr"
`;

export function parseCliOptions(args: string[]): PipelineOptions {
  const options: PipelineOptions = {
    inputPath: path.resolve(args[0]),
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
      case '--database-url':
        options.databaseUrl = args[++i];
        break;
      case '--api-url':
        console.warn(`--api-url ${args[++i]} is ignored: chunks are synced straight to the database now (see --database-url).`);
        break;
    }
  }

  return options;
}

function printBanner(options: PipelineOptions, source: BookSource): void {
  console.log(`
============================================================
  EPUB to Book Processing Pipeline
============================================================
  Input: ${options.inputPath} (${source.label})
  Output: public/${options.outputDir}/
  Model: ${options.model}
  Filter: ${options.filter}
  Skip Rephrase: ${options.skipRephrase}
============================================================
`);
}

function printSummary(options: PipelineOptions, { bookName }: PreparedBook): void {
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

async function main(options: PipelineOptions) {
  if (!fs.existsSync(options.inputPath)) {
    console.error(`Error: not found: ${options.inputPath}`);
    process.exit(1);
  }

  const source = selectBookSource(options);
  const needsPython = source.needsPython || !options.skipRephrase;
  if (needsPython) assertPythonHasMeCab();
  printBanner(options, source);

  console.log(`\n=== Preparing the book: ${source.label} ===\n`);
  const book = source.prepare({ libraryDir: path.join(REPO_ROOT, 'public', options.outputDir), filter: options.filter });
  await runSteps(PIPELINE_STEPS, { options, book });
  printSummary(options, book);
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
