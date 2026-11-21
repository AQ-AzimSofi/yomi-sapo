/**
 * Book identity: a text_entries row, named by its directory and file name.
 *
 * Where the two travel as one string they form the book key "directory/fileName",
 * whose last segment is the file. Bookmark rows, library progress and the legacy
 * combined `fileName=` query param all use that key.
 */

export interface BookRef {
  directory: string;
  fileName: string;
}

// Books stored before books had directories; a key with no slash names one of these.
export const LEGACY_BOOK_DIRECTORY = 'public';

export function toBookKey(book: BookRef): string {
  return `${book.directory}/${book.fileName}`;
}

export function parseBookKey(key: string): BookRef {
  const lastSlash = key.lastIndexOf('/');
  if (lastSlash < 0) return { directory: LEGACY_BOOK_DIRECTORY, fileName: key };
  return { directory: key.slice(0, lastSlash), fileName: key.slice(lastSlash + 1) };
}

/**
 * The book named by `directory` and `fileName` params, or by a combined
 * `fileName=directory/file` alone, which readers loaded before the two were sent
 * apart still send. Both forms go through the joined key, so they name the same book.
 */
export function bookRefFromParams(directory: string | null | undefined, fileName: string): BookRef {
  return parseBookKey(directory ? `${directory}/${fileName}` : fileName);
}

export function sameBook(a: BookRef, b: BookRef): boolean {
  return a.directory === b.directory && a.fileName === b.fileName;
}

function isSafeSegment(segment: string): boolean {
  return segment !== '' && segment !== '..' && !segment.includes('\\');
}

/**
 * Whether a book stays inside the book folders. Every part of its key must be
 * non-empty (so no leading, doubled or trailing slash) and not '..', and no part
 * may hold a backslash, which Windows reads as a separator.
 */
export function isSafeBookRef(book: BookRef): boolean {
  return toBookKey(book).split('/').every(isSafeSegment);
}

export function bookQuery(book: BookRef): string {
  return `directory=${encodeURIComponent(book.directory)}&fileName=${encodeURIComponent(book.fileName)}`;
}

/**
 * The key a book's ruby registry and starred words are stored under: the top-level
 * directory, and the rest of the book's directory as its name.
 */
export function rubyRegistryKey(book: BookRef): { directory: string; bookName: string } {
  const [topDirectory, ...bookFolders] = book.directory.split('/');
  return { directory: topDirectory, bookName: bookFolders.join('/') };
}
