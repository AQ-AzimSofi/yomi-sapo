import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookSource } from './bookSources';
import { runBook, runSteps, type PipelineContext, type PipelineOptions, type PreparedBook, type Step } from './runner';

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
const CONTEXT: PipelineContext = { options: OPTIONS, book: { bookName: 'book', sourceDir: 'public/bookv2-furigana/book' } };

function createStep(name: string, ranNames: string[], overrides: Partial<Step> = {}): Step {
  return {
    name,
    shouldRun: () => true,
    run: async () => {
      ranNames.push(name);
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSteps', () => {
  it('Test_runSteps_RunsStepsInListOrder', async () => {
    const ranNames: string[] = [];
    await runSteps([createStep('a', ranNames), createStep('b', ranNames), createStep('c', ranNames)], CONTEXT);
    expect(ranNames).toEqual(['a', 'b', 'c']);
  });

  it('Test_runSteps_SkipsAStepWhoseShouldRunIsFalse', async () => {
    const ranNames: string[] = [];
    const steps = [createStep('a', ranNames), createStep('b', ranNames, { shouldRun: () => false }), createStep('c', ranNames)];
    await runSteps(steps, CONTEXT);
    expect(ranNames).toEqual(['a', 'c']);
  });

  it('Test_runSteps_ShouldRunAndRunGetTheContext', async () => {
    const shouldRun = vi.fn(() => true);
    const run = vi.fn(async () => undefined);
    await runSteps([{ name: 'a', shouldRun, run }], CONTEXT);
    expect(shouldRun).toHaveBeenCalledWith(CONTEXT);
    expect(run).toHaveBeenCalledWith(CONTEXT);
  });

  it('Test_runSteps_AThrowingStepStopsTheRun', async () => {
    const ranNames: string[] = [];
    const failingStep = createStep('b', ranNames, { run: async () => Promise.reject(new Error('b failed')) });
    await expect(runSteps([createStep('a', ranNames), failingStep, createStep('c', ranNames)], CONTEXT)).rejects.toThrow('b failed');
    expect(ranNames).toEqual(['a']);
  });

  it('Test_runSteps_WaitsForEachStepBeforeTheNext', async () => {
    const ranNames: string[] = [];
    const slowStep = createStep('slow', ranNames, {
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        ranNames.push('slow');
      },
    });
    await runSteps([slowStep, createStep('next', ranNames)], CONTEXT);
    expect(ranNames).toEqual(['slow', 'next']);
  });
});

describe('runBook', () => {
  // Japanese, as every real book name is: fs.cpSync kills Node 24 on Windows on such a path.
  const BOOK_NAME = '人間失格';
  const TEXT_FILE = BOOK_NAME + '.txt';
  const PROGRESS_FILE = BOOK_NAME + '-rephrase-progress.json';
  const tempDirs: string[] = [];

  function createLibrary(): string {
    const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
    tempDirs.push(libraryDir);
    return libraryDir;
  }

  function writeEarlierRun(libraryDir: string): void {
    fs.mkdirSync(path.join(libraryDir, BOOK_NAME, 'chunks'), { recursive: true });
    fs.writeFileSync(path.join(libraryDir, BOOK_NAME, TEXT_FILE), 'earlier text');
    fs.writeFileSync(path.join(libraryDir, BOOK_NAME, PROGRESS_FILE), '{"version":2}');
    fs.writeFileSync(path.join(libraryDir, BOOK_NAME, 'chunks', '0000.furigana.txt'), 'chunk');
  }

  // Like the EPUB source: prepare writes the book's text into the library it is given.
  const WRITING_SOURCE: BookSource = {
    label: 'test',
    needsPython: false,
    prepare: ({ libraryDir }) => {
      const sourceDir = path.join(libraryDir, BOOK_NAME);
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, TEXT_FILE), 'extracted text');
      return { bookName: BOOK_NAME, sourceDir };
    },
  };

  function listFiles(dir: string): Record<string, string> {
    const filePaths = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((entry) => fs.statSync(path.join(dir, entry)).isFile());
    return Object.fromEntries(filePaths.map((filePath) => [filePath, fs.readFileSync(path.join(dir, filePath), 'utf-8')]));
  }

  function createRecordingStep(seenBooks: PreparedBook[]): Step {
    return createStep('record', [], { run: async ({ book }) => { seenBooks.push(book); } });
  }

  afterEach(() => {
    tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  it('Test_runBook_PreparesTheBookInTheLibraryAndRunsTheSteps', async () => {
    const libraryDir = createLibrary();
    const seenBooks: PreparedBook[] = [];
    await runBook(WRITING_SOURCE, [createRecordingStep(seenBooks)], { options: OPTIONS, libraryDir });
    expect(seenBooks).toEqual([{ bookName: BOOK_NAME, sourceDir: path.join(libraryDir, BOOK_NAME) }]);
    expect(listFiles(libraryDir)).toEqual({ [path.join(BOOK_NAME, TEXT_FILE)]: 'extracted text' });
  });

  it('Test_runBook_DryRunOfANewBookWritesNothingToTheLibrary', async () => {
    const libraryDir = createLibrary();
    await runBook(WRITING_SOURCE, [createRecordingStep([])], { options: { ...OPTIONS, dryRun: true }, libraryDir });
    expect(fs.readdirSync(libraryDir)).toEqual([]);
  });

  it('Test_runBook_DryRunLeavesAnExistingBookFolderUnchanged', async () => {
    const libraryDir = createLibrary();
    writeEarlierRun(libraryDir);
    const before = listFiles(libraryDir);
    await runBook(WRITING_SOURCE, [createRecordingStep([])], { options: { ...OPTIONS, dryRun: true }, libraryDir });
    expect(listFiles(libraryDir)).toEqual(before);
  });

  it('Test_runBook_DryRunStepsSeeTheNewTextWithTheSavedProgress', async () => {
    const libraryDir = createLibrary();
    writeEarlierRun(libraryDir);
    const seenFiles: Record<string, string>[] = [];
    const step = createStep('record', [], { run: async ({ book }) => { seenFiles.push(listFiles(book.sourceDir)); } });
    await runBook(WRITING_SOURCE, [step], { options: { ...OPTIONS, dryRun: true }, libraryDir });
    expect(seenFiles).toEqual([{ [TEXT_FILE]: 'extracted text', [PROGRESS_FILE]: '{"version":2}', [path.join('chunks', '0000.furigana.txt')]: 'chunk' }]);
  });

  it('Test_runBook_DryRunRemovesItsCopyWhenAStepThrows', async () => {
    const libraryDir = createLibrary();
    const seenBooks: PreparedBook[] = [];
    const failingStep = createStep('fail', [], { run: async ({ book }) => { seenBooks.push(book); throw new Error('step failed'); } });
    await expect(runBook(WRITING_SOURCE, [failingStep], { options: { ...OPTIONS, dryRun: true }, libraryDir })).rejects.toThrow('step failed');
    expect(seenBooks).toHaveLength(1);
    expect(fs.existsSync(seenBooks[0].sourceDir)).toBe(false);
  });
});
