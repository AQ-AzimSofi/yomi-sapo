#!/usr/bin/env -S npx tsx --conditions=react-server
/**
 * Copies one book file into text_entries on the local database. The book pipeline runs it after
 * every chunk; run it by hand after editing a book file. It refuses any database host other than
 * localhost or 127.0.0.1: production gets books through npm run db:sync.
 *
 * The react-server condition is the one Next.js resolves server code with; without it the
 * server-only guard in lib/db/connection.ts throws.
 *
 *   npx tsx --conditions=react-server scripts/db/sync-text-entry.ts \
 *     --directory "bookv2-furigana/<book>" \
 *     --file-name "<book>-rephrase-furigana" \
 *     --file "public/bookv2-furigana/<book>/<book>-rephrase-furigana.txt"
 */

import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { isEntryPoint } from '../shared/entryPoint';
import { loadRepoEnv } from '../shared/repoPaths';
import { isLocalDatabase } from './localDatabase';

export interface TextEntryFile {
  directory: string;
  fileName: string;
  filePath: string;
}

/**
 * Upserts the file's content as the (directory, fileName) row. lib/db is imported here rather than at
 * the top because its connection reads DATABASE_URL on import, which must come after .env.local loads.
 */
export async function syncTextEntryFile({ directory, fileName, filePath }: TextEntryFile): Promise<void> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) throw new Error('No DATABASE_URL in the environment or .env.local');
  const { sql } = await import('@/lib/db/connection');
  const hosts = sql.options.host;
  if (!isLocalDatabase(hosts)) {
    throw new Error(`refusing to write to ${hosts.join(', ')}: only a database on localhost or 127.0.0.1 is synced from here`);
  }
  const { upsertTextEntry } = await import('@/lib/db/queries');
  await upsertTextEntry(fileName, fs.readFileSync(filePath, 'utf-8'), directory);
}

function parseCliArgs(): TextEntryFile {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string' },
      'file-name': { type: 'string' },
      file: { type: 'string' },
    },
  });
  const { directory, 'file-name': fileName, file: filePath } = values;
  if (!directory || !fileName || !filePath) {
    throw new Error('Usage: --directory <dir> --file-name <name> --file <path of the text file>');
  }
  return { directory, fileName, filePath };
}

async function main(): Promise<void> {
  loadRepoEnv();
  try {
    await syncTextEntryFile(parseCliArgs());
  } finally {
    const { sql } = await import('@/lib/db/connection');
    await sql.end();
  }
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`    Database sync failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
