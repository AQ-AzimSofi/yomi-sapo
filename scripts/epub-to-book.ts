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
 * Usage: npx tsx scripts/epub-to-book.ts <book.epub | ocr folder> [options]; --help lists the options and their defaults.
 */

import * as fs from 'fs';
import * as path from 'path';
import { selectBookSource, type BookSource } from './pipeline/bookSources';
import { PIPELINE_STEPS } from './pipeline/pipelineSteps';
import { runBook, type PipelineOptions, type PreparedBook } from './pipeline/runner';
import { assertPythonHasMeCab } from './shared/python';
import { loadRepoEnv, REPO_ROOT } from './shared/repoPaths';
import { isEntryPoint } from './shared/entryPoint';
import { choiceFlag, formatHelp, isHelpRequested, numberFlag, parseCommandLine, switchFlag, textFlag } from './shared/cliSchema';

// ============================================================================
// Command Line
// ============================================================================

export const BOOK_PIPELINE_FLAGS = {
  outputDir: textFlag({ name: 'output-dir', valueName: 'dir', defaultValue: 'bookv2-furigana', description: 'Output directory in public/' }),
  chunkSize: numberFlag({ name: 'chunk-size', valueName: 'n', defaultValue: 5000, isInteger: true, min: 1, description: 'Target characters per chunk' }),
  delaySeconds: numberFlag({
    name: 'delay',
    valueName: 'n',
    defaultValue: 0,
    isInteger: true,
    min: 0,
    description: 'Gemini: least seconds between two requests on the same key, on top of waiting out rate limits (429); Claude ignores it',
  }),
  model: textFlag({ name: 'model', valueName: 'name', defaultValue: 'sonnet', description: 'Claude model (sonnet, opus) or a gemini-* model' }),
  skipExtract: switchFlag({ name: 'skip-extract', description: 'Use public/<output-dir>/<book>/<book>.txt as it is; the input path only names the book' }),
  skipRephrase: switchFlag({ name: 'skip-rephrase', description: "Only extract, don't rephrase" }),
  skipImages: switchFlag({ name: 'skip-images', description: 'Has no effect: the EPUB extractor always writes the images' }),
  filter: choiceFlag({ name: 'filter', valueName: 'level', choices: ['all', 'n3'], defaultValue: 'all', description: 'Kanji filter' }),
  reset: switchFlag({ name: 'reset', description: 'Start fresh, ignore existing progress' }),
  dryRun: switchFlag({ name: 'dry-run', description: 'Show the plan and write nothing (an EPUB or OCR folder is prepared in a temp copy)' }),
  databaseUrl: textFlag({
    name: 'database-url',
    valueName: 'url',
    defaultLabel: 'DATABASE_URL, then POSTGRES_URL',
    description: 'Local database each chunk is synced to; other hosts are refused',
  }),
  apiUrl: textFlag({ name: 'api-url', valueName: 'url', description: 'Ignored: chunks are synced straight to the database (see --database-url)' }),
};

export const HELP_TEXT = formatHelp(BOOK_PIPELINE_FLAGS, {
  summary: 'Book pipeline: EPUB or OCR text -> furigana, rephrase, local database',
  usage: [
    'npx tsx scripts/epub-to-book.ts <epub-file> [options]',
    'npx tsx scripts/epub-to-book.ts <ocr-pages.ts output folder> [options]',
    'npx tsx scripts/epub-to-book.ts <any path named after the book> --skip-extract [options]',
  ],
  examples: [
    'npx tsx scripts/epub-to-book.ts "my-book.epub"',
    'npx tsx scripts/epub-to-book.ts "my-book.epub" --delay 300 --filter n3',
    'npx tsx scripts/epub-to-book.ts "my-book.epub" --skip-rephrase',
    'npx tsx scripts/epub-to-book.ts "temp/books/my-book-ocr"',
  ],
});

export function parseCliOptions(args: string[]): PipelineOptions {
  const { flags, positionals } = parseCommandLine(BOOK_PIPELINE_FLAGS, args);
  const { apiUrl, ...pipelineFlags } = flags;
  if (apiUrl !== undefined) console.warn(`--api-url ${apiUrl} is ignored: chunks are synced straight to the database now (see --database-url).`);
  const [inputArg] = positionals;
  if (inputArg === undefined) throw new Error('Pass the EPUB, the OCR folder or, with --skip-extract, a path named after the book (see --help).');
  return { inputPath: path.resolve(inputArg), ...pipelineFlags };
}

// ============================================================================
// Main
// ============================================================================

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
  if (options.dryRun) {
    console.log(`\nDry run complete: nothing was written to public/${options.outputDir}/${bookName}/.`);
    return;
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
  const book = await runBook(source, PIPELINE_STEPS, { options, libraryDir: path.join(REPO_ROOT, 'public', options.outputDir) });
  printSummary(options, book);
}

async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || isHelpRequested(args)) {
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
