import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BookSource } from './bookSources';

export type KanjiFilter = 'all' | 'n3';

export interface PipelineOptions {
  /** The EPUB, or with --skip-extract any path named after the book. */
  inputPath: string;
  outputDir: string;
  chunkSize: number;
  delaySeconds: number;
  model: string;
  skipRephrase: boolean;
  skipExtract: boolean;
  skipImages: boolean;
  filter: KanjiFilter;
  reset: boolean;
  dryRun: boolean;
  /** Where each chunk is synced; unset means the DATABASE_URL the app uses. Only a local database is accepted. */
  databaseUrl?: string;
}

export interface PreparedBook {
  bookName: string;
  /** public/<outputDir>/<bookName>, the folder every step reads and writes. */
  sourceDir: string;
  /** Set when the book was extracted from an EPUB, for the steps that read it again. */
  epubPath?: string;
}

export interface PipelineContext {
  options: PipelineOptions;
  book: PreparedBook;
}

export interface Step {
  name: string;
  shouldRun: (context: PipelineContext) => boolean;
  run: (context: PipelineContext) => Promise<void>;
}

/** Runs the steps in order. A step that throws stops the run, so later steps never see a half-made book. */
export async function runSteps(steps: readonly Step[], context: PipelineContext): Promise<void> {
  for (const [stepIndex, step] of steps.entries()) {
    const label = `Step ${stepIndex + 1}/${steps.length}: ${step.name}`;
    if (!step.shouldRun(context)) {
      console.log(`\n=== Skipping ${label} ===`);
      continue;
    }
    console.log(`\n=== ${label} ===\n`);
    await step.run(context);
  }
}

export interface BookRunSettings {
  options: PipelineOptions;
  /** public/<outputDir>, which holds one folder per book. */
  libraryDir: string;
}

/** Prepares the book from its source and runs the steps on it; a dry run does both on a copy. */
export async function runBook(source: BookSource, steps: readonly Step[], { options, libraryDir }: BookRunSettings): Promise<PreparedBook> {
  if (options.dryRun) return rehearseBook(source, steps, { options, libraryDir });
  const book = source.prepare({ libraryDir, filter: options.filter });
  await runSteps(steps, { options, book });
  return book;
}

/**
 * The source prepares the book in a temp library, and the book's existing folder is copied in
 * beside it (force: false keeps the new text), so the steps plan from the text a real run would
 * use and the progress it would resume. The copy is removed afterwards and public/ never changes.
 */
async function rehearseBook(source: BookSource, steps: readonly Step[], { options, libraryDir }: BookRunSettings): Promise<PreparedBook> {
  const scratchLibraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-dry-run-'));
  console.log(`Dry run: the book is prepared in ${scratchLibraryDir}, removed afterwards; nothing in public/ changes.\n`);
  try {
    const book = source.prepare({ libraryDir: scratchLibraryDir, filter: options.filter });
    const libraryBookDir = path.join(libraryDir, book.bookName);
    // Not fs.cpSync: it kills Node 24 on Windows outright when a path holds Japanese.
    if (fs.existsSync(libraryBookDir)) await fs.promises.cp(libraryBookDir, book.sourceDir, { recursive: true, force: false });
    await runSteps(steps, { options, book });
    return book;
  } finally {
    fs.rmSync(scratchLibraryDir, { recursive: true, force: true });
  }
}
