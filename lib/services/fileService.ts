import 'server-only';
import * as fs from 'fs/promises';
import path from 'path';
import type { RubyRegistry, RubyEntry } from '@/lib/types';

// A literal 'public' lets Next's file tracer scope this module to public/;
// an imported constant made it trace the whole repo into every route that loads this module.
const PUBLIC_ROOT = path.join(process.cwd(), 'public');

function publicFilePath(fileName: string): string {
  return path.join(PUBLIC_ROOT, fileName);
}

export async function readTextFile(fileName: string): Promise<string> {
  const flatPath = publicFilePath(`${fileName}.txt`);

  try {
    return await fs.readFile(flatPath, 'utf8');
  } catch {
    const parts = fileName.split('/');
    const baseFileName = parts[parts.length - 1];
    const nestedPath = publicFilePath(`${fileName}/${baseFileName}.txt`);

    try {
      return await fs.readFile(nestedPath, 'utf8');
    } catch {
      return '';
    }
  }
}

const RUBY_REGISTRY_FILE = 'ruby-registry.json';

function getRubyRegistryPath(directory: string, bookName: string): string {
  return path.join(PUBLIC_ROOT, directory, bookName, RUBY_REGISTRY_FILE);
}

export async function readRubyRegistry(directory: string, bookName: string): Promise<RubyRegistry | null> {
  const filePath = getRubyRegistryPath(directory, bookName);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function writeRubyRegistry(
  directory: string,
  bookName: string,
  registry: RubyRegistry
): Promise<void> {
  const filePath = getRubyRegistryPath(directory, bookName);
  await fs.writeFile(filePath, JSON.stringify(registry, null, 2), 'utf8');
}

export async function upsertRubyEntry(
  directory: string,
  bookName: string,
  entry: RubyEntry
): Promise<RubyRegistry> {
  let registry = await readRubyRegistry(directory, bookName);

  if (!registry) {
    registry = {
      bookTitle: bookName,
      entries: [],
      suggestions: []
    };
  }

  const existingIndex = registry.entries.findIndex(e => e.kanji === entry.kanji);
  if (existingIndex >= 0) {
    registry.entries[existingIndex] = entry;
  } else {
    registry.entries.push(entry);
  }

  registry.suggestions = registry.suggestions.filter(s => s.kanji !== entry.kanji);

  await writeRubyRegistry(directory, bookName, registry);
  return registry;
}

export async function deleteRubyEntry(
  directory: string,
  bookName: string,
  kanji: string
): Promise<RubyRegistry | null> {
  const registry = await readRubyRegistry(directory, bookName);
  if (!registry) return null;

  registry.entries = registry.entries.filter(e => e.kanji !== kanji);
  await writeRubyRegistry(directory, bookName, registry);
  return registry;
}

export async function ignoreSuggestion(
  directory: string,
  bookName: string,
  kanji: string
): Promise<RubyRegistry | null> {
  const registry = await readRubyRegistry(directory, bookName);
  if (!registry) return null;

  registry.suggestions = registry.suggestions.filter(s => s.kanji !== kanji);
  await writeRubyRegistry(directory, bookName, registry);
  return registry;
}
