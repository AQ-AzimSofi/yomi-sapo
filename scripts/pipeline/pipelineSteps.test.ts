import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractRubyRegistry } from './epubExtraction';
import { illustrationUploadStep, PIPELINE_STEPS, rephraseStep, rubyRegistryStep, runUntilInterrupted } from './pipelineSteps';
import type { PipelineContext, PipelineOptions, PreparedBook } from './runner';

vi.mock('./epubExtraction', () => ({ extractRubyRegistry: vi.fn() }));

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
};
const TEXT_BOOK: PreparedBook = { bookName: 'book', sourceDir: 'public/bookv2-furigana/book' };
const EPUB_BOOK: PreparedBook = { ...TEXT_BOOK, epubPath: 'book.epub' };

function createContext(book: PreparedBook, options: Partial<PipelineOptions> = {}): PipelineContext {
  return { options: { ...OPTIONS, ...options }, book };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(extractRubyRegistry).mockReset();
});

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

  it('Test_rubyRegistryStep_WritesIntoTheBookFolder', async () => {
    await rubyRegistryStep.run(createContext(EPUB_BOOK));
    expect(extractRubyRegistry).toHaveBeenCalledWith('book.epub', 'public/bookv2-furigana/book');
  });

  it('Test_rubyRegistryStep_AFailureWarnsAndLetsTheBookContinue', async () => {
    vi.mocked(extractRubyRegistry).mockImplementation(() => {
      throw new Error('extract-ruby-smart.py exited with 1');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(rubyRegistryStep.run(createContext(EPUB_BOOK))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Ruby registry not written (extract-ruby-smart.py exited with 1)'));
  });
});

describe('runUntilInterrupted', () => {
  function runUntilStopped() {
    return runUntilInterrupted((signal) => new Promise<string>((resolve) => signal.addEventListener('abort', () => resolve('stopped'))));
  }

  it('Test_runUntilInterrupted_CtrlCStopsTheTaskAndStaysListening', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stopped = runUntilStopped();
    // tsx's own SIGINT listener runs after the program's and exits at once when none is left.
    const listenerCountsSeenByTsx: number[] = [];
    const tsxListener = () => listenerCountsSeenByTsx.push(process.listenerCount('SIGINT'));
    process.on('SIGINT', tsxListener);
    const listenerCountBefore = process.listenerCount('SIGINT');

    process.emit('SIGINT');
    process.off('SIGINT', tsxListener);

    expect(await stopped).toBe('stopped');
    expect(listenerCountsSeenByTsx).toEqual([listenerCountBefore]);
  });

  it('Test_runUntilInterrupted_SecondCtrlCExitsWith130', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stopped = runUntilStopped();

    process.emit('SIGINT');
    process.emit('SIGINT');

    expect(exitSpy).toHaveBeenCalledWith(130);
    await stopped;
  });

  it('Test_runUntilInterrupted_StopsListeningOnceTheTaskEnds', async () => {
    const listenerCountBefore = process.listenerCount('SIGINT');
    await runUntilInterrupted(async () => 'done');
    expect(process.listenerCount('SIGINT')).toBe(listenerCountBefore);
  });
});
