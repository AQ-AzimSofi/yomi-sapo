import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectBookSource } from './bookSources';
import { hasPythonBookPackages } from './fixtures/tinyEpub';
import type { FuriganaResult } from './furigana';
import { buildBookText, createOcrDirSource, readOcrDirLayout } from './ocrDirSource';
import type { KanjiFilter } from './runner';

const BOOK_NAME = '本';
const JOINED_TEXT = '猫がいる。\n\n[IMAGE:0002-1.png]\n\n犬もいる。\n';
// Runs the real Python steps, which take a few seconds each on Windows.
const PYTHON_STEP_TIMEOUT_MS = 60_000;

interface OcrFixture {
  workDir: string;
  ocrDir: string;
  libraryDir: string;
}

function writeOcrDir(workDir: string, files: Record<string, string>): string {
  const ocrDir = path.join(workDir, `${BOOK_NAME}-ocr`);
  Object.entries(files).forEach(([relativePath, content]) => {
    const filePath = path.join(ocrDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  });
  return ocrDir;
}

function createFixture(files: Record<string, string>): OcrFixture {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-ocr-'));
  return { workDir, ocrDir: writeOcrDir(workDir, files), libraryDir: path.join(workDir, 'library') };
}

const OCR_FILES = {
  'pages/0001.txt': '猫がいる。',
  'pages/0002.txt': '[IMAGE:0002-1.png]\n犬もいる。',
  'images/0002-1.png': 'png bytes',
  [`${BOOK_NAME}.txt`]: JOINED_TEXT,
};

// Like the Python step on Windows: CRLF and ruby on every 猫.
function addFakeFurigana(text: string): FuriganaResult {
  return { text: text.replace(/\n/g, '\r\n').replace(/猫/g, '<ruby>猫<rt>ねこ</rt></ruby>') };
}

const fixtures: OcrFixture[] = [];

function useFixture(files: Record<string, string>): OcrFixture {
  const fixture = createFixture(files);
  fixtures.push(fixture);
  return fixture;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fixtures.splice(0).forEach(({ workDir }) => fs.rmSync(workDir, { recursive: true, force: true }));
});

describe('readOcrDirLayout', () => {
  it('Test_readOcrDirLayout_NamesTheBookAfterTheJoinedText', () => {
    const { ocrDir } = useFixture(OCR_FILES);
    expect(readOcrDirLayout(ocrDir)).toEqual({
      bookName: BOOK_NAME,
      joinedTextPath: path.join(ocrDir, `${BOOK_NAME}.txt`),
      figuresDir: path.join(ocrDir, 'images'),
    });
  });

  it('Test_readOcrDirLayout_NoFiguresFolderIsFine', () => {
    const { ocrDir } = useFixture({ 'pages/0001.txt': '猫', [`${BOOK_NAME}.txt`]: '猫' });
    expect(readOcrDirLayout(ocrDir).figuresDir).toBeUndefined();
  });

  it('Test_readOcrDirLayout_FolderWithoutPagesThrows', () => {
    const { ocrDir } = useFixture({ [`${BOOK_NAME}.txt`]: '猫' });
    expect(() => readOcrDirLayout(ocrDir)).toThrow(/not an ocr-pages\.ts output folder.*--skip-extract/);
  });

  it('Test_readOcrDirLayout_TwoJoinedTextsThrow', () => {
    const { ocrDir } = useFixture({ 'pages/0001.txt': '猫', 'a.txt': '猫', 'b.txt': '犬' });
    expect(() => readOcrDirLayout(ocrDir)).toThrow(/one joined \.txt.*has 2: a\.txt, b\.txt/);
  });
});

describe('buildBookText', () => {
  it('Test_buildBookText_HeaderThenBodyWithUnixLineEnds', () => {
    expect(buildBookText(BOOK_NAME, '猫\r\n\r\n犬\r\n')).toBe('Title: 本\nAuthor: Unknown\n\n猫\n\n犬');
  });
});

describe('selectBookSource', () => {
  it('Test_selectBookSource_AFolderIsOcrOutput', () => {
    const { ocrDir } = useFixture(OCR_FILES);
    expect(selectBookSource({ inputPath: ocrDir, skipExtract: false }).label).toBe('ocr-pages.ts output');
  });

  it('Test_selectBookSource_SkipExtractKeepsAFolderAsTheBookName', () => {
    const { ocrDir } = useFixture(OCR_FILES);
    expect(selectBookSource({ inputPath: ocrDir, skipExtract: true }).needsPython).toBe(false);
  });
});

describe('createOcrDirSource', () => {
  it('Test_prepare_WritesTheBookTextWithFurigana', () => {
    const { ocrDir, libraryDir } = useFixture(OCR_FILES);

    const book = createOcrDirSource(ocrDir, addFakeFurigana).prepare({ libraryDir, filter: 'all' });

    expect(book).toEqual({ bookName: BOOK_NAME, sourceDir: path.join(libraryDir, BOOK_NAME) });
    expect(fs.readFileSync(path.join(book.sourceDir, `${BOOK_NAME}.txt`), 'utf-8')).toBe(
      'Title: 本\nAuthor: Unknown\n\n<ruby>猫<rt>ねこ</rt></ruby>がいる。\n\n[IMAGE:0002-1.png]\n\n犬もいる。',
    );
  });

  it('Test_prepare_CopiesTheFiguresIntoTheBookImages', () => {
    const { ocrDir, libraryDir } = useFixture(OCR_FILES);

    const book = createOcrDirSource(ocrDir, addFakeFurigana).prepare({ libraryDir, filter: 'all' });

    expect(fs.readFileSync(path.join(book.sourceDir, 'images', '0002-1.png'), 'utf-8')).toBe('png bytes');
  });

  it('Test_prepare_PassesTheKanjiFilter', () => {
    const { ocrDir, libraryDir } = useFixture(OCR_FILES);
    const filters: KanjiFilter[] = [];

    createOcrDirSource(ocrDir, (text, filter) => {
      filters.push(filter);
      return { text };
    }).prepare({ libraryDir, filter: 'n3' });

    expect(filters).toEqual(['n3']);
  });

  it('Test_prepare_AFuriganaFailureThrowsWithoutWritingTheBook', () => {
    const { ocrDir, libraryDir } = useFixture(OCR_FILES);
    const source = createOcrDirSource(ocrDir, (text) => ({ text, error: 'MeCab missing' }));

    expect(() => source.prepare({ libraryDir, filter: 'all' })).toThrow(/Furigana .* failed: MeCab missing/);
    expect(fs.existsSync(path.join(libraryDir, BOOK_NAME))).toBe(false);
  });

  it('Test_prepare_RerunWritesTheSameText', () => {
    const { ocrDir, libraryDir } = useFixture(OCR_FILES);
    const source = createOcrDirSource(ocrDir, addFakeFurigana);
    const textPath = path.join(libraryDir, BOOK_NAME, `${BOOK_NAME}.txt`);

    source.prepare({ libraryDir, filter: 'all' });
    const firstText = fs.readFileSync(textPath, 'utf-8');
    source.prepare({ libraryDir, filter: 'all' });

    expect(fs.readFileSync(textPath, 'utf-8')).toBe(firstText);
  });

  it.skipIf(!hasPythonBookPackages())('Test_prepare_RealPythonAddsRuby', () => {
    const { ocrDir, libraryDir } = useFixture(OCR_FILES);

    const book = createOcrDirSource(ocrDir).prepare({ libraryDir, filter: 'all' });

    const text = fs.readFileSync(path.join(book.sourceDir, `${BOOK_NAME}.txt`), 'utf-8');
    expect(text).toBe('Title: 本\nAuthor: Unknown\n\n<ruby>猫<rt>ねこ</rt></ruby>がいる。\n\n[IMAGE:0002-1.png]\n\n<ruby>犬<rt>いぬ</rt></ruby>もいる。');
  }, PYTHON_STEP_TIMEOUT_MS);
});
