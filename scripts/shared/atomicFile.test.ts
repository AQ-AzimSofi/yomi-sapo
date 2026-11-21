import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from './atomicFile';

function busyError(): NodeJS.ErrnoException {
  return Object.assign(new Error('resource busy'), { code: 'EBUSY' });
}

describe('writeFileAtomic', () => {
  const testDir = path.join(os.tmpdir(), 'atomic-file-test');
  const filePath = path.join(testDir, 'out.txt');

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('Test_writeFileAtomic_ReplacesContentAndLeavesNoTempFile', () => {
    fs.writeFileSync(filePath, 'old');
    writeFileAtomic(filePath, '新しい');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('新しい');
    expect(fs.readdirSync(testDir)).toEqual(['out.txt']);
  });

  it('Test_writeFileAtomic_RetriesABusyRename', () => {
    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync')
      .mockImplementationOnce(() => {
        throw busyError();
      })
      .mockImplementation(realRename);
    writeFileAtomic(filePath, 'a');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('a');
  });

  it('Test_writeFileAtomic_RemovesTempFileWhenRenameKeepsFailing', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EISDIR' });
    });
    expect(() => writeFileAtomic(filePath, 'a')).toThrow('denied');
    expect(fs.readdirSync(testDir)).toEqual([]);
  });
});
