import fs from 'node:fs';

const MAX_RENAME_TRIES = 10;
const RENAME_RETRY_DELAY_MS = 100;
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export type WriteFile = (filePath: string, content: string) => void;

function pauseSync(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

// Windows refuses to replace a file that another process (antivirus, OneDrive, the dev server) briefly holds open.
function renameWithRetry(fromPath: string, toPath: string, tryNumber: number): void {
  try {
    fs.renameSync(fromPath, toPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!RETRYABLE_RENAME_CODES.has(code) || tryNumber >= MAX_RENAME_TRIES) throw error;
    pauseSync(RENAME_RETRY_DELAY_MS);
    renameWithRetry(fromPath, toPath, tryNumber + 1);
  }
}

/** Replaces the file in one step, so a killed process leaves either the old content or the new, never part of it. */
export function writeFileAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  try {
    renameWithRetry(tempPath, filePath, 1);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}
