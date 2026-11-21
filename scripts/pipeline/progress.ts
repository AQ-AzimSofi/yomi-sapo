import * as fs from 'fs';
import * as path from 'path';
import { stripRubyTags } from './chunking';

export interface ProgressFile {
  version: number;
  source: {
    fileName: string;
    directory: string;
    totalCharacters: number;
    hash: string;
  };
  chunks: {
    total: number;
    completed: number;
    items: ChunkProgress[];
  };
  settings: {
    chunkSize: number;
    delaySeconds: number;
    model: string;
  };
  startedAt: string;
  lastUpdatedAt: string;
}

export interface ChunkProgress {
  index: number;
  startChar: number;
  endChar: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  completedAt?: string;
  error?: string;
}

export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export function getProgressPath(sourceDir: string, bookName: string): string {
  return path.join(sourceDir, `${bookName}-rephrase-progress.json`);
}

export function loadProgress(progressPath: string): ProgressFile | null {
  if (!fs.existsSync(progressPath)) return null;
  try {
    const content = fs.readFileSync(progressPath, 'utf-8');
    return JSON.parse(content) as ProgressFile;
  } catch {
    return null;
  }
}

export function saveProgress(progressPath: string, progress: ProgressFile): void {
  progress.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
}

export interface NewProgress {
  bookName: string;
  directory: string;
  sourceText: string;
  boundaries: { start: number; end: number }[];
  settings: { chunkSize: number; delaySeconds: number; model: string };
}

export function createProgress({ bookName, directory, sourceText, boundaries, settings }: NewProgress): ProgressFile {
  return {
    version: 1,
    source: {
      fileName: bookName,
      directory: directory,
      totalCharacters: stripRubyTags(sourceText).length,
      hash: simpleHash(sourceText),
    },
    chunks: {
      total: boundaries.length,
      completed: 0,
      items: boundaries.map((boundary, index) => ({
        index,
        startChar: boundary.start,
        endChar: boundary.end,
        status: 'pending' as const,
        attempts: 0,
      })),
    },
    settings: {
      chunkSize: settings.chunkSize,
      delaySeconds: settings.delaySeconds,
      model: settings.model,
    },
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
}
