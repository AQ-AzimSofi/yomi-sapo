import { describe, expect, it } from 'vitest';
import { illustrationUploadStep, PIPELINE_STEPS, rephraseStep, rubyRegistryStep } from './pipelineSteps';
import type { PipelineContext, PipelineOptions, PreparedBook } from './runner';

const OPTIONS: PipelineOptions = {
  inputPath: 'book.epub',
  outputDir: 'bookv2-furigana',
  chunkSize: 5000,
  delaySeconds: 0,
  model: 'sonnet',
  skipRephrase: false,
  skipExtract: false,
  skipImages: false,
  filter: 'all',
  reset: false,
  dryRun: false,
  apiUrl: 'http://127.0.0.1:9',
};
const TEXT_BOOK: PreparedBook = { bookName: 'book', sourceDir: 'public/bookv2-furigana/book' };
const EPUB_BOOK: PreparedBook = { ...TEXT_BOOK, epubPath: 'book.epub' };

function createContext(book: PreparedBook, options: Partial<PipelineOptions> = {}): PipelineContext {
  return { options: { ...OPTIONS, ...options }, book };
}

describe('pipeline steps', () => {
  it('Test_PIPELINE_STEPS_RubyRegistryThenUploadThenRephrase', () => {
    expect(PIPELINE_STEPS).toEqual([rubyRegistryStep, illustrationUploadStep, rephraseStep]);
  });

  it('Test_rubyRegistryStep_RunsOnlyForABookFromAnEpub', () => {
    expect(rubyRegistryStep.shouldRun(createContext(EPUB_BOOK))).toBe(true);
    expect(rubyRegistryStep.shouldRun(createContext(TEXT_BOOK))).toBe(false);
  });

  it('Test_illustrationUploadStep_RunsForEveryBook', () => {
    expect(illustrationUploadStep.shouldRun(createContext(TEXT_BOOK, { skipRephrase: true }))).toBe(true);
  });

  it('Test_rephraseStep_SkippedBySkipRephrase', () => {
    expect(rephraseStep.shouldRun(createContext(TEXT_BOOK))).toBe(true);
    expect(rephraseStep.shouldRun(createContext(TEXT_BOOK, { skipRephrase: true }))).toBe(false);
  });
});
