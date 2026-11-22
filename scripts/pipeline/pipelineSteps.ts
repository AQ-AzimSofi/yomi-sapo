import { extractRubyRegistry } from './epubExtraction';
import { uploadBookImages } from './illustrationUpload';
import { batchRephrase, defaultRephraseDeps } from './rephraseBook';
import type { Step } from './runner';
import { createDatabaseSync } from './textEntrySync';

// The reader works without a ruby registry, so a failure here warns instead of stopping the book.
export const rubyRegistryStep: Step = {
  name: 'Ruby Registry',
  shouldRun: ({ book }) => book.epubPath !== undefined,
  run: async ({ book }) => {
    if (!book.epubPath) throw new Error('The ruby registry needs the EPUB the book came from');
    try {
      extractRubyRegistry(book.epubPath, book.sourceDir);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Ruby registry not written (${reason}). The reader works without it; run the book again to retry.`);
    }
  },
};

// Runs before rephrasing, so chunks synced during the rephrase are readable with their images straight away.
export const illustrationUploadStep: Step = {
  name: 'Illustration Upload',
  shouldRun: () => true,
  run: async ({ options, book }) => uploadBookImages(book, options.outputDir, options.dryRun),
};

/**
 * Runs the task with a signal that Ctrl+C aborts. Only the first Ctrl+C is caught, so a second
 * one kills the process the usual way should the stop itself hang.
 */
async function runUntilInterrupted<Result>(task: (signal: AbortSignal) => Promise<Result>): Promise<Result> {
  const stopController = new AbortController();
  const onInterrupt = () => {
    console.log('\n\nCtrl+C: stopping. Saved chunks are kept; a chunk in flight is redone on the next run.');
    stopController.abort();
  };
  process.once('SIGINT', onInterrupt);
  try {
    return await task(stopController.signal);
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}

export const rephraseStep: Step = {
  name: 'Rephrase',
  shouldRun: ({ options }) => !options.skipRephrase,
  run: async ({ options, book }) => {
    const syncToDatabase = createDatabaseSync(options.databaseUrl);
    const isComplete = await runUntilInterrupted((stopSignal) => batchRephrase(book, options, { ...defaultRephraseDeps, syncToDatabase, stopSignal }));
    if (isComplete || options.dryRun) return;
    console.log('\nRephrasing incomplete. Run again to resume.');
  },
};

export const PIPELINE_STEPS: readonly Step[] = [rubyRegistryStep, illustrationUploadStep, rephraseStep];
