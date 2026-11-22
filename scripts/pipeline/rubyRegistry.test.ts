import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractRubyRegistry } from './epubExtraction';
import { hasPythonBookPackages, writeTinyEpub } from './fixtures/tinyEpub';

// Runs the real Python steps, which take a few seconds each on Windows.
const PYTHON_STEP_TIMEOUT_MS = 60_000;

interface RubyRegistry {
  bookTitle: string;
  entries: { kanji: string; reading: string; source: string; note: string }[];
}

function readRegistry(bookDir: string): RubyRegistry {
  return JSON.parse(fs.readFileSync(path.join(bookDir, 'ruby-registry.json'), 'utf-8')) as RubyRegistry;
}

describe.skipIf(!hasPythonBookPackages())('extractRubyRegistry (real Python)', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-ruby-'));
  const epubPath = path.join(workDir, 'tiny.epub');

  beforeAll(() => writeTinyEpub(epubPath, '小さな本'));
  afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

  it('Test_extractRubyRegistry_WritesTheRegistryIntoTheBookFolder', () => {
    const bookDir = path.join(workDir, 'library', '小さな本');
    fs.mkdirSync(bookDir, { recursive: true });

    extractRubyRegistry(epubPath, bookDir);

    const registry = readRegistry(bookDir);
    expect(registry.bookTitle).toBe('小さな本');
    expect(registry.entries.map(({ kanji, reading }) => [kanji, reading])).toEqual([
      ['吾輩', 'わがはい'],
      ['東京', 'ひがしきょう'],
      ['歩く', 'あるく'],
    ]);
  }, PYTHON_STEP_TIMEOUT_MS);

  it('Test_extractRubyRegistry_FolderNamedUnlikeTheEpubStillGetsItsRegistry', () => {
    const bookDir = path.join(workDir, 'library', 'まったく別の名前');
    fs.mkdirSync(bookDir, { recursive: true });

    extractRubyRegistry(epubPath, bookDir);

    expect(readRegistry(bookDir).bookTitle).toBe('まったく別の名前');
  }, PYTHON_STEP_TIMEOUT_MS);

  it('Test_extractRubyRegistry_ACorruptEpubThrows', () => {
    const corruptEpubPath = path.join(workDir, 'corrupt.epub');
    fs.writeFileSync(corruptEpubPath, 'not a zip archive');
    const bookDir = path.join(workDir, 'library', 'corrupt');

    expect(() => extractRubyRegistry(corruptEpubPath, bookDir)).toThrow(/exited with 1/);
    expect(fs.existsSync(path.join(bookDir, 'ruby-registry.json'))).toBe(false);
  }, PYTHON_STEP_TIMEOUT_MS);
});
