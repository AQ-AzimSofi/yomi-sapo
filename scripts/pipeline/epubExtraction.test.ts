import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractEpub, parseExtractionResult } from './epubExtraction';
import { hasPythonBookPackages, writeTinyEpub } from './fixtures/tinyEpub';

// Runs the real Python steps, which take a few seconds each on Windows.
const PYTHON_STEP_TIMEOUT_MS = 60_000;
const BOOK_NAME = '小さな本 試験';
const RESULT = { bookName: '本', textPath: 'C:\\books\\本\\本.txt', metadataPath: 'C:\\books\\本\\本.json' };

describe('parseExtractionResult', () => {
  it('Test_parseExtractionResult_ReadsTheLastLine', () => {
    expect(parseExtractionResult(`stray output\r\n${JSON.stringify(RESULT)}\r\n`)).toEqual(RESULT);
  });

  it('Test_parseExtractionResult_NoJsonThrows', () => {
    expect(() => parseExtractionResult('[OK] Done!\n')).toThrow(/did not end with its JSON result line.*\[OK\] Done!/);
  });

  it('Test_parseExtractionResult_EmptyOutputThrows', () => {
    expect(() => parseExtractionResult('')).toThrow(/\(nothing\)/);
  });

  it('Test_parseExtractionResult_MissingFieldThrows', () => {
    expect(() => parseExtractionResult(JSON.stringify({ bookName: '本', textPath: 'x' }))).toThrow(/JSON result line/);
  });
});

describe.skipIf(!hasPythonBookPackages())('extractEpub (real Python)', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-extract-'));
  const epubPath = path.join(workDir, 'tiny.epub');

  beforeAll(() => writeTinyEpub(epubPath, '小さな本: 試験'));
  afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('Test_extractEpub_WritesTheBookFolderNamedAfterTheTitle', () => {
    const libraryDir = path.join(workDir, 'library-basic');
    const book = extractEpub(epubPath, libraryDir, 'all');

    const bookDir = path.join(libraryDir, BOOK_NAME);
    expect(book).toEqual({
      bookName: BOOK_NAME,
      textPath: path.join(bookDir, `${BOOK_NAME}.txt`),
      metadataPath: path.join(bookDir, `${BOOK_NAME}.json`),
    });
    const text = fs.readFileSync(book.textPath, 'utf-8');
    expect(text).toMatch(/^Title: 小さな本: 試験\r?\nAuthor: 試験 太郎\r?\n/);
    expect(text).toContain('<ruby>吾輩<rt>わがはい</rt></ruby>');
    expect(text).toContain('[IMAGE:fig1.png]');
    expect(fs.readdirSync(path.join(bookDir, 'images')).sort()).toEqual(['illustration-000.png', 'illustration-001.png']);
  }, PYTHON_STEP_TIMEOUT_MS);

  it('Test_extractEpub_ReextractingABookReturnsItEvenWhenAnotherFolderIsNewer', () => {
    const libraryDir = path.join(workDir, 'library-reextract');
    extractEpub(epubPath, libraryDir, 'all');
    fs.mkdirSync(path.join(libraryDir, 'a book made later'));

    expect(extractEpub(epubPath, libraryDir, 'all').bookName).toBe(BOOK_NAME);
  }, PYTHON_STEP_TIMEOUT_MS);

  it('Test_extractEpub_ACorruptEpubThrows', () => {
    const corruptEpubPath = path.join(workDir, 'corrupt.epub');
    fs.writeFileSync(corruptEpubPath, 'not a zip archive');

    expect(() => extractEpub(corruptEpubPath, path.join(workDir, 'library-corrupt'), 'all')).toThrow(/exited with 1/);
  }, PYTHON_STEP_TIMEOUT_MS);
});
