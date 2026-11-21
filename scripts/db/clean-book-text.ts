#!/usr/bin/env npx tsx
/**
 * Normalizes stored book text: Windows line endings become LF (so every reader,
 * the library and narration split books into the same units), and markup junk
 * that EPUB extraction and the rephrase model left behind is removed (the reader
 * escapes HTML, so the junk would otherwise show as text).
 *
 * Dry run by default. Run it once per database (local, then --prod).
 * updated_at is left unchanged on purpose: the dev sync is last-write-wins on
 * it, so bumping it could push a stale local copy over a newer production one.
 *
 * Usage:
 *   npx tsx scripts/db/clean-book-text.ts            # local, dry run
 *   npx tsx scripts/db/clean-book-text.ts --apply    # local, write
 *   npx tsx scripts/db/clean-book-text.ts --prod --apply
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { cleanBookText } from './bookTextCleanup';

dotenv.config({ path: '.env.local' });

interface TextEntryRow {
  id: number;
  directory: string;
  file_name: string;
  content: string;
}

function createClient(isProd: boolean): pg.Client {
  const connectionString = isProd ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(`${isProd ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set in .env.local`);
  }
  return isProd
    ? new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
    : new pg.Client({ connectionString });
}

function describeRemovals(removedByRule: Record<string, number>): string {
  return Object.entries(removedByRule)
    .filter(([, count]) => count > 0)
    .map(([rule, count]) => `${rule} x${count}`)
    .join(', ');
}

async function main(): Promise<void> {
  const isProd = process.argv.includes('--prod');
  const shouldApply = process.argv.includes('--apply');
  const client = createClient(isProd);
  await client.connect();

  try {
    const { rows } = await client.query<TextEntryRow>('SELECT id, directory, file_name, content FROM text_entries ORDER BY id');
    const changes = rows
      .map((row) => ({ row, ...cleanBookText(row.content) }))
      .filter(({ row, cleaned }) => cleaned !== row.content);

    console.log(`${isProd ? 'production' : 'local'}: ${changes.length} of ${rows.length} books need cleaning`);
    changes.forEach(({ row, removedByRule }) => {
      console.log(`  ${row.directory}/${row.file_name}: ${describeRemovals(removedByRule)}`);
    });

    if (!shouldApply) {
      console.log('Dry run. Add --apply to write the changes.');
      return;
    }

    for (const { row, cleaned } of changes) {
      await client.query('UPDATE text_entries SET content = $1 WHERE id = $2', [cleaned, row.id]);
    }
    console.log(`Updated ${changes.length} books.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
