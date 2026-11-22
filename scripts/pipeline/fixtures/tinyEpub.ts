import path from 'node:path';
import { runPython } from '../../shared/python';

const MAKE_TINY_EPUB_SCRIPT = path.join(__dirname, 'make-tiny-epub.py');

/** Whether the Python the pipeline calls can run its EPUB and furigana steps; CI's has none of the packages. */
export function hasPythonBookPackages(): boolean {
  try {
    runPython(['-c', 'import MeCab, ebooklib, bs4, lxml'], { isStderrCaptured: true });
    return true;
  } catch {
    return false;
  }
}

/** Writes a two-chapter EPUB with ruby, a cover and one illustration. */
export function writeTinyEpub(epubPath: string, title: string): void {
  runPython([MAKE_TINY_EPUB_SCRIPT, epubPath, title], { isStderrCaptured: true });
}
