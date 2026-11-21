import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREVIEW_PAGES,
  PUBLIC_BOOKS,
  findPublicBook,
  isPublicBookAsset,
  isPublicDirectory,
} from './publicBooks';
import { parseBookKey } from './books/bookRef';
import { bookAssetPath, bookImagePath } from './utils/bookAssetPath';

const [previewBook, otherPreviewBook] = PUBLIC_BOOKS;
const previewFolderName = previewBook.directory.slice(previewBook.directory.lastIndexOf('/') + 1);
const UNKNOWN_DIRECTORY = 'bookv2-furigana/架空の本';
const UNKNOWN_FILE_NAME = '架空の本-rephrase-furigana';

describe('PUBLIC_BOOKS', () => {
  it('keeps each preview book in a bookv2-furigana folder named after its rephrase-furigana file', () => {
    const expectedDirectories = PUBLIC_BOOKS.map(
      (book) => `bookv2-furigana/${book.fileName.replace(/-rephrase-furigana$/, '')}`
    );

    expect(PUBLIC_BOOKS.map((book) => book.directory)).toEqual(expectedDirectories);
  });

  it('caps every preview book at the default preview length of 5 pages', () => {
    expect(DEFAULT_PREVIEW_PAGES).toBe(5);
    expect(PUBLIC_BOOKS.map((book) => book.maxPreviewPages)).toEqual(PUBLIC_BOOKS.map(() => DEFAULT_PREVIEW_PAGES));
  });
});

describe('findPublicBook', () => {
  it('returns the allowlisted entry for its directory and file name', () => {
    expect(findPublicBook(previewBook.directory, previewBook.fileName)).toBe(previewBook);
  });

  it('returns null for an unknown book', () => {
    expect(findPublicBook(UNKNOWN_DIRECTORY, UNKNOWN_FILE_NAME)).toBeNull();
  });

  it('returns null when the file name belongs to a different preview book', () => {
    expect(findPublicBook(previewBook.directory, otherPreviewBook.fileName)).toBeNull();
  });

  it('returns null for the right file name in the parent directory', () => {
    expect(findPublicBook('bookv2-furigana', previewBook.fileName)).toBeNull();
  });

  it.each([
    ['a null directory', null, previewBook.fileName],
    ['an undefined directory', undefined, previewBook.fileName],
    ['an empty directory', '', previewBook.fileName],
    ['a null file name', previewBook.directory, null],
    ['an undefined file name', previewBook.directory, undefined],
    ['an empty file name', previewBook.directory, ''],
  ])('returns null for %s', (_case, directory, fileName) => {
    expect(findPublicBook(directory, fileName)).toBeNull();
  });

  it.each([
    ['a trailing slash on the directory', `${previewBook.directory}/`, previewBook.fileName],
    ['a directory that climbs out of the preview book', `${previewBook.directory}/../架空の本`, previewBook.fileName],
    ['a directory that climbs back into the preview book', `bookv2-furigana/架空の本/../${previewFolderName}`, previewBook.fileName],
    ['a file name that climbs up a level', previewBook.directory, `../${previewBook.fileName}`],
  ])('returns null for %s', (_case, directory, fileName) => {
    expect(findPublicBook(directory, fileName)).toBeNull();
  });
});

// Routes parse the combined fileName=dir/file form into a BookRef before matching.
describe('findPublicBook on a combined book key', () => {
  function findPublicBookByKey(bookKey: string) {
    const { directory, fileName } = parseBookKey(bookKey);
    return findPublicBook(directory, fileName);
  }

  it('returns the allowlisted entry for its joined directory and file name', () => {
    expect(findPublicBookByKey(`${previewBook.directory}/${previewBook.fileName}`)).toBe(previewBook);
  });

  it('returns null for an unknown book', () => {
    expect(findPublicBookByKey(`${UNKNOWN_DIRECTORY}/${UNKNOWN_FILE_NAME}`)).toBeNull();
  });

  it('returns null for the directory alone', () => {
    expect(findPublicBookByKey(previewBook.directory)).toBeNull();
  });

  it('returns null for an empty key', () => {
    expect(findPublicBookByKey('')).toBeNull();
  });

  it.each([
    ['a leading slash', `/${previewBook.directory}/${previewBook.fileName}`],
    ['a path that climbs back into the preview book', `bookv2-furigana/架空の本/../${previewFolderName}/${previewBook.fileName}`],
    ['a path that climbs out of the preview book', `${previewBook.directory}/../${UNKNOWN_FILE_NAME}`],
  ])('returns null for %s', (_case, bookKey) => {
    expect(findPublicBookByKey(bookKey)).toBeNull();
  });
});

describe('isPublicBookAsset', () => {
  it('accepts an illustration inside a preview book folder', () => {
    expect(isPublicBookAsset(`/${previewBook.directory}/images/p1.png`)).toBe(true);
  });

  it('accepts the metadata and illustrations of every preview book', () => {
    const assetPaths = PUBLIC_BOOKS.flatMap((book) => [
      bookAssetPath(book.directory, book.fileName, '.json'),
      bookImagePath(book.directory, book.fileName, 'p1.png'),
    ]);

    expect(assetPaths.filter((assetPath) => !isPublicBookAsset(assetPath))).toEqual([]);
  });

  it('rejects an asset of an unknown book', () => {
    expect(isPublicBookAsset(`/${UNKNOWN_DIRECTORY}/images/p1.png`)).toBe(false);
  });

  it('rejects a book whose folder name only starts with a preview book name', () => {
    expect(isPublicBookAsset(`/${previewBook.directory} 2/images/p1.png`)).toBe(false);
  });

  it('rejects a path without the leading slash', () => {
    expect(isPublicBookAsset(`${previewBook.directory}/images/p1.png`)).toBe(false);
  });

  it('rejects the preview book folder itself', () => {
    expect(isPublicBookAsset(`/${previewBook.directory}`)).toBe(false);
  });

  it('rejects an empty path', () => {
    expect(isPublicBookAsset('')).toBe(false);
  });

  // The book-assets route rejects '..' segments before calling this, so this is not reachable today.
  it.todo('rejects a path that climbs out of a preview book folder with .. segments (hardening)');
});

describe('isPublicDirectory', () => {
  it('accepts a preview book directory', () => {
    expect(isPublicDirectory(previewBook.directory)).toBe(true);
  });

  it('rejects the shared parent directory', () => {
    expect(isPublicDirectory('bookv2-furigana')).toBe(false);
  });

  it('rejects an unknown directory', () => {
    expect(isPublicDirectory(UNKNOWN_DIRECTORY)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty directory', ''],
  ])('rejects %s', (_case, directory) => {
    expect(isPublicDirectory(directory)).toBe(false);
  });

  it.each([
    ['a trailing slash', `${previewBook.directory}/`],
    ['a directory that climbs out of the preview book', `${previewBook.directory}/..`],
    ['a directory that climbs back into the preview book', `bookv2-furigana/架空の本/../${previewFolderName}`],
  ])('rejects %s', (_case, directory) => {
    expect(isPublicDirectory(directory)).toBe(false);
  });
});
