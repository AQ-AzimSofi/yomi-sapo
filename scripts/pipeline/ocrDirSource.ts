import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../shared/atomicFile';
import type { BookSource } from './bookSources';
import { addFuriganaWithPython, type FuriganaResult } from './furigana';
import type { KanjiFilter } from './runner';

export type AddFurigana = (text: string, filter: KanjiFilter) => FuriganaResult;

/** The parts of an ocr-pages.ts output folder the book is made from. */
export interface OcrDirLayout {
  /** The joined text is named after the screenshot folder, which names the book. */
  bookName: string;
  joinedTextPath: string;
  figuresDir?: string;
}

function isDirectory(dirPath: string): boolean {
  return fs.statSync(dirPath, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Throws unless the folder holds pages/ and exactly one joined .txt, as ocr-pages.ts writes them. */
export function readOcrDirLayout(ocrDir: string): OcrDirLayout {
  if (!isDirectory(path.join(ocrDir, 'pages'))) {
    throw new Error(
      `${ocrDir} is a folder but not an ocr-pages.ts output folder (it has no pages/ folder). ` +
        'To process text already in public/<output-dir>/<book>/<book>.txt, pass that folder with --skip-extract.',
    );
  }
  const joinedTextNames = fs.readdirSync(ocrDir).filter((name) => name.endsWith('.txt') && !isDirectory(path.join(ocrDir, name)));
  if (joinedTextNames.length !== 1) {
    throw new Error(`An ocr-pages.ts output folder holds one joined .txt, but ${ocrDir} has ${joinedTextNames.length}: ${joinedTextNames.join(', ')}`);
  }
  const figuresDir = path.join(ocrDir, 'images');
  return {
    bookName: path.basename(joinedTextNames[0], '.txt'),
    joinedTextPath: path.join(ocrDir, joinedTextNames[0]),
    figuresDir: isDirectory(figuresDir) ? figuresDir : undefined,
  };
}

// File by file because fs.cpSync kills Node 24 on Windows outright when a path holds Japanese.
// ocr-pages.ts writes its figures into one flat folder.
function copyFigures(figuresDir: string, imagesDir: string): void {
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.readdirSync(figuresDir).forEach((fileName) => fs.copyFileSync(path.join(figuresDir, fileName), path.join(imagesDir, fileName)));
}

/** The same layout epub-to-text-furigana.py writes: a Title/Author header without furigana, then the body with it. */
export function buildBookText(bookName: string, bodyWithFurigana: string): string {
  return `Title: ${bookName}\nAuthor: Unknown\n\n${bodyWithFurigana.replace(/\r\n/g, '\n').trim()}`;
}

/**
 * An ocr-pages.ts output folder: its joined text gets furigana and becomes <book>.txt, and its cropped
 * figures are copied to the book's images/ so the upload step sends them with the book.
 */
export function createOcrDirSource(ocrDir: string, addFurigana: AddFurigana = addFuriganaWithPython): BookSource {
  const layout = readOcrDirLayout(ocrDir);
  return {
    label: 'ocr-pages.ts output',
    needsPython: true,
    prepare: ({ libraryDir, filter }) => {
      const sourceDir = path.join(libraryDir, layout.bookName);
      const furigana = addFurigana(fs.readFileSync(layout.joinedTextPath, 'utf-8').trim(), filter);
      if (furigana.error) throw new Error(`Furigana for ${layout.joinedTextPath} failed: ${furigana.error}`);

      fs.mkdirSync(sourceDir, { recursive: true });
      writeFileAtomic(path.join(sourceDir, `${layout.bookName}.txt`), buildBookText(layout.bookName, furigana.text));
      if (layout.figuresDir) copyFigures(layout.figuresDir, path.join(sourceDir, 'images'));
      console.log(`Prepared ${layout.bookName}.txt from ${layout.joinedTextPath}${layout.figuresDir ? ', with its figures' : ''}`);
      return { bookName: layout.bookName, sourceDir };
    },
  };
}
