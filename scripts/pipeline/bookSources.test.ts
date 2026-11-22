import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEpubSource, createTextFileSource, selectBookSource } from './bookSources';
import { hasPythonBookPackages, writeTinyEpub } from './fixtures/tinyEpub';

const LIBRARY_DIR = path.join('public', 'bookv2-furigana');
const SETTINGS = { libraryDir: LIBRARY_DIR, filter: 'all' as const };
// Runs the real Python steps, which take a few seconds each on Windows.
const PYTHON_STEP_TIMEOUT_MS = 60_000;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selectBookSource', () => {
  it('Test_selectBookSource_SkipExtractUsesTheTextAlreadyInTheBookFolder', () => {
    const source = selectBookSource({ inputPath: 'temp/books/本', skipExtract: true });
    expect(source.needsPython).toBe(false);
    expect(source.prepare(SETTINGS)).toEqual({ bookName: '本', sourceDir: path.join(LIBRARY_DIR, '本') });
  });

  it('Test_selectBookSource_AFileIsAnEpub', () => {
    const source = selectBookSource({ inputPath: 'book.epub', skipExtract: false });
    expect(source.label).toBe('EPUB');
    expect(source.needsPython).toBe(true);
  });
});

describe('createTextFileSource', () => {
  it('Test_createTextFileSource_FolderNamesTheBook', () => {
    expect(createTextFileSource('temp/books/愛するということ').prepare(SETTINGS).bookName).toBe('愛するということ');
  });

  it('Test_createTextFileSource_FileNamesTheBookWithoutItsExtension', () => {
    expect(createTextFileSource('public/bookv2-furigana/本/本.txt').prepare(SETTINGS).bookName).toBe('本');
  });

  it('Test_createTextFileSource_HasNoEpubForTheRubyRegistry', () => {
    expect(createTextFileSource('本').prepare(SETTINGS).epubPath).toBeUndefined();
  });
});

describe.skipIf(!hasPythonBookPackages())('createEpubSource (real Python)', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-epub-source-'));
  afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

  it('Test_createEpubSource_PreparesTheExtractedBookFolder', () => {
    const epubPath = path.join(workDir, 'tiny.epub');
    writeTinyEpub(epubPath, '小さな本');
    const libraryDir = path.join(workDir, 'library');

    const book = createEpubSource(epubPath).prepare({ libraryDir, filter: 'all' });

    expect(book).toEqual({ bookName: '小さな本', sourceDir: path.join(libraryDir, '小さな本'), epubPath });
    expect(fs.existsSync(path.join(book.sourceDir, '小さな本.txt'))).toBe(true);
  }, PYTHON_STEP_TIMEOUT_MS);
});
