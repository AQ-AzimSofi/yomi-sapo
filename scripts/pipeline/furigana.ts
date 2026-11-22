import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPython } from '../shared/python';
import { CORE_SCRIPTS_DIR } from '../shared/repoPaths';
import type { KanjiFilter } from './runner';

/** On failure `text` is the input unchanged and `error` says why. */
export interface FuriganaResult {
  text: string;
  error?: string;
}

const MAX_FURIGANA_ERROR_CHARS = 300;

export function addFuriganaWithPython(readerText: string, filter: KanjiFilter = 'all'): FuriganaResult {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yomi-furigana-'));
  try {
    const inputPath = path.join(workDir, 'chunk.txt');
    const outputPath = path.join(workDir, 'chunk-furigana.txt');
    fs.writeFileSync(inputPath, readerText, 'utf-8');
    const filterArgs = filter === 'n3' ? ['--filter', 'n3'] : [];
    runPython([path.join(CORE_SCRIPTS_DIR, 'add-furigana-to-text.py'), inputPath, '-o', outputPath, ...filterArgs], { isStderrCaptured: true });
    return { text: fs.readFileSync(outputPath, 'utf-8') };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { text: readerText, error: reason.slice(0, MAX_FURIGANA_ERROR_CHARS) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
