import { extractRubyRegistry } from './epubExtraction';
import { uploadBookImages } from './illustrationUpload';
import { batchRephrase, defaultRephraseDeps } from './rephraseBook';
import type { Step } from './runner';

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
  run: async ({ options, book }) => uploadBookImages(options.outputDir, book.bookName, options.dryRun),
};

export const rephraseStep: Step = {
  name: 'Rephrase',
  shouldRun: ({ options }) => !options.skipRephrase,
  run: async ({ options, book }) => {
    const isComplete = await batchRephrase(book, options, defaultRephraseDeps);
    if (isComplete || options.dryRun) return;
    console.log('\nRephrasing incomplete. Run again to resume.');
  },
};

export const PIPELINE_STEPS: readonly Step[] = [rubyRegistryStep, illustrationUploadStep, rephraseStep];
