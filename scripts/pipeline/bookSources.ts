import * as path from 'path';
import { extractEpub } from './epubExtraction';
import type { KanjiFilter, PipelineOptions, PreparedBook } from './runner';

export interface SourceSettings {
  /** public/<outputDir>, which holds one folder per book. */
  libraryDir: string;
  filter: KanjiFilter;
}

/** Where a book's text comes from. prepare() leaves <libraryDir>/<book>/<book>.txt ready for the steps. */
export interface BookSource {
  /** What the run banner calls the input. */
  label: string;
  needsPython: boolean;
  prepare: (settings: SourceSettings) => PreparedBook;
}

export function createEpubSource(epubPath: string): BookSource {
  return {
    label: 'EPUB',
    needsPython: true,
    prepare: ({ libraryDir, filter }) => {
      const { bookName } = extractEpub(epubPath, libraryDir, filter);
      return { bookName, sourceDir: path.join(libraryDir, bookName), epubPath };
    },
  };
}

/** --skip-extract: the text is already in the book folder, and the input path only names the book. */
export function createTextFileSource(inputPath: string): BookSource {
  return {
    label: 'existing book text (--skip-extract)',
    needsPython: false,
    prepare: ({ libraryDir }) => {
      const bookName = path.basename(inputPath, path.extname(inputPath));
      console.log(`Using existing book: ${bookName}`);
      return { bookName, sourceDir: path.join(libraryDir, bookName) };
    },
  };
}

export function selectBookSource({ inputPath, skipExtract }: Pick<PipelineOptions, 'inputPath' | 'skipExtract'>): BookSource {
  return skipExtract ? createTextFileSource(inputPath) : createEpubSource(inputPath);
}
