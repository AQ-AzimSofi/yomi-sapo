import { extractRubyRegistry } from './epubExtraction';
import { uploadBookImages } from './illustrationUpload';
import { batchRephrase, defaultRephraseDeps } from './rephraseBook';
import type { Step } from './runner';

export const rubyRegistryStep: Step = {
  name: 'Ruby Registry',
  shouldRun: ({ book }) => book.epubPath !== undefined,
  run: async ({ book }) => {
    if (!book.epubPath) throw new Error('The ruby registry needs the EPUB the book came from');
    extractRubyRegistry(book.epubPath);
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
