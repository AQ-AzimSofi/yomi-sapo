import * as path from 'path';
import { describePython, resolvePython, runPython } from '../shared/python';
import { CORE_SCRIPTS_DIR } from '../shared/repoPaths';
import type { KanjiFilter } from './runner';

const EXTRACT_SCRIPT = path.join(CORE_SCRIPTS_DIR, 'epub-to-text-furigana.py');
const RUBY_REGISTRY_SCRIPT = path.join(CORE_SCRIPTS_DIR, 'extract-ruby-smart.py');

/** What epub-to-text-furigana.py prints as the last line of its stdout. */
export interface ExtractedBook {
  /** The book folder's name, the EPUB title made safe for a file name. */
  bookName: string;
  textPath: string;
  metadataPath: string;
}

function isExtractedBook(value: unknown): value is ExtractedBook {
  if (typeof value !== 'object' || value === null) return false;
  const { bookName, textPath, metadataPath } = value as Record<string, unknown>;
  return [bookName, textPath, metadataPath].every((field) => typeof field === 'string' && field.length > 0);
}

function parseJsonOrUndefined(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function parseExtractionResult(stdout: string): ExtractedBook {
  const resultLine = stdout.trim().split('\n').at(-1) ?? '';
  const parsed = parseJsonOrUndefined(resultLine);
  if (!isExtractedBook(parsed)) {
    throw new Error(`epub-to-text-furigana.py did not end with its JSON result line; it printed: ${resultLine || '(nothing)'}`);
  }
  return parsed;
}

/** Extracts the EPUB into <libraryDir>/<book>/ and returns the book it wrote. Throws when the extraction fails. */
export function extractEpub(epubPath: string, libraryDir: string, filter: KanjiFilter): ExtractedBook {
  const scriptArgs = [EXTRACT_SCRIPT, epubPath, ...(filter === 'n3' ? ['--filter', 'n3'] : []), '--output', libraryDir];
  console.log(`Running: ${describePython(resolvePython())} ${scriptArgs.join(' ')}\n`);
  const book = parseExtractionResult(runPython(scriptArgs));
  console.log(`\nExtracted to: ${book.bookName}`);
  return book;
}

/** Writes <bookDir>/ruby-registry.json from the EPUB's ruby. Throws when the EPUB cannot be read. */
export function extractRubyRegistry(epubPath: string, bookDir: string): void {
  runPython([RUBY_REGISTRY_SCRIPT, epubPath, '--out', path.join(bookDir, 'ruby-registry.json')]);
}
