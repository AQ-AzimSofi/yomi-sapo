import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextFileSource, selectBookSource } from './bookSources';

const LIBRARY_DIR = path.join('public', 'bookv2-furigana');
const SETTINGS = { libraryDir: LIBRARY_DIR, filter: 'all' as const };

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
