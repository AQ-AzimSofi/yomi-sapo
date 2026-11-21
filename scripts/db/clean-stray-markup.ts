#!/usr/bin/env npx tsx
/**
 * Removes markup junk that EPUB extraction and the rephrase model left in book
 * text. The reader now escapes HTML, so this junk would otherwise show as text.
 *
 * Dry run by default. Run it once per database (local, then --prod).
 * updated_at is left unchanged on purpose: the dev sync is last-write-wins on
 * it, so bumping it could push a stale local copy over a newer production one.
 *
 * Usage:
 *   npx tsx scripts/db/clean-stray-markup.ts            # local, dry run
 *   npx tsx scripts/db/clean-stray-markup.ts --apply    # local, write
 *   npx tsx scripts/db/clean-stray-markup.ts --prod --apply
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { cleanStrayMarkup } from './strayMarkup';

dotenv.config({ path: '.env.local' });

interface TextEntryRow {
  id: number;
  directory: string;
  file_name: string;
  content: string;
}

interface Connection {
  client: pg.Client;
  host: string;
}

const KNOWN_FLAGS = ['--prod', '--apply'];

// One statement, so every book is written or none is. A book that changed after
// it was read is skipped instead of being overwritten with a stale cleaned copy.
const UPDATE_UNCHANGED_BOOKS_SQL = `
  UPDATE text_entries AS entry
  SET content = change.cleaned
  FROM unnest($1::int[], $2::text[], $3::text[]) AS change(id, original, cleaned)
  WHERE entry.id = change.id AND entry.content = change.original
  RETURNING entry.id`;

function connect(isProd: boolean): Connection {
  const connectionString = isProd ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(`${isProd ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set in .env.local`);
  }
  const client = isProd
    ? new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
    : new pg.Client({ connectionString });
  return { client, host: new URL(connectionString).hostname };
}

function describeRemovals(removedByRule: Record<string, number>): string {
  return Object.entries(removedByRule)
    .filter(([, count]) => count > 0)
    .map(([rule, count]) => `${rule} x${count}`)
    .join(', ');
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  const unknownFlags = flags.filter((flag) => !KNOWN_FLAGS.includes(flag));
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown arguments: ${unknownFlags.join(' ')}. Only --prod and --apply are accepted.`);
  }
  const isProd = flags.includes('--prod');
  const shouldApply = flags.includes('--apply');
  const { client, host } = connect(isProd);
  await client.connect();

  try {
    const { rows } = await client.query<TextEntryRow>('SELECT id, directory, file_name, content FROM text_entries ORDER BY id');
    const changes = rows
      .map((row) => ({ row, ...cleanStrayMarkup(row.content) }))
      .filter(({ row, cleaned }) => cleaned !== row.content);

    console.log(`${isProd ? 'production' : 'local'} (${host}): ${changes.length} of ${rows.length} books have stray markup`);
    changes.forEach(({ row, removedByRule }) => {
      console.log(`  ${row.directory}/${row.file_name}: ${describeRemovals(removedByRule)}`);
    });

    if (!shouldApply) {
      console.log('Dry run. Add --apply to write the changes.');
      return;
    }

    const { rows: writtenRows } = await client.query<{ id: number }>(UPDATE_UNCHANGED_BOOKS_SQL, [
      changes.map(({ row }) => row.id),
      changes.map(({ row }) => row.content),
      changes.map(({ cleaned }) => cleaned),
    ]);
    const writtenIds = new Set(writtenRows.map(({ id }) => id));
    const skipped = changes.filter(({ row }) => !writtenIds.has(row.id));
    console.log(`Updated ${writtenIds.size} books.`);
    if (skipped.length > 0) {
      const skippedNames = skipped.map(({ row }) => `${row.directory}/${row.file_name}`).join(', ');
      throw new Error(`Skipped ${skipped.length} books that changed after they were read: ${skippedNames}. Run the script again.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
