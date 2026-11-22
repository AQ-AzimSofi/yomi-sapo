import * as fs from 'fs';
import * as path from 'path';
import { describePython, resolvePython, runPython } from '../shared/python';
import { CORE_SCRIPTS_DIR, REPO_ROOT } from '../shared/repoPaths';
import type { KanjiFilter } from './runner';

const EXTRACT_SCRIPT = path.join(CORE_SCRIPTS_DIR, 'epub-to-text-furigana.py');

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

// ============================================================================
// Ruby Registry Extraction
// ============================================================================

export function extractRubyRegistry(epubPath: string): boolean {
  // Create temp directory and copy EPUB there for extract-ruby-smart.py
  const tempDir = path.join(REPO_ROOT, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const epubName = path.basename(epubPath);
  const tempEpubPath = path.join(tempDir, epubName);

  // Copy EPUB to temp
  fs.copyFileSync(epubPath, tempEpubPath);
  console.log(`Copied EPUB to: ${tempEpubPath}`);

  try {
    runPython([path.join(CORE_SCRIPTS_DIR, 'extract-ruby-smart.py')]);

    // Clean up temp file
    if (fs.existsSync(tempEpubPath)) {
      fs.unlinkSync(tempEpubPath);
    }

    return true;
  } catch (error) {
    console.error('Error extracting ruby registry:', error);
    // Clean up on error
    if (fs.existsSync(tempEpubPath)) {
      fs.unlinkSync(tempEpubPath);
    }
    return false;
  }
}
