#!/usr/bin/env npx tsx
/**
 * Normalizes stored book text: Windows line endings become LF (so every reader,
 * the library and narration split books into the same units), and markup junk
 * that EPUB extraction and the rephrase model left behind is removed (the reader
 * escapes HTML, so the junk would otherwise show as text).
 * Bookmarks store the text of the paragraph they point at, so they get the same
 * cleaning; otherwise a bookmark on a cleaned paragraph would stop matching.
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
import { parseCleanupFlags } from './cleanupFlags';

dotenv.config({ path: '.env.local' });

interface TextEntryRow {
  id: number;
  directory: string;
  file_name: string;
  content: string;
}

interface BookmarkRow {
  id: number;
  bookmark_text: string;
}

interface TextChange {
  id: number;
  original: string;
  cleaned: string;
}

interface Connection {
  client: pg.Client;
  host: string;
}

// One statement, so every row is written or none is. A row that changed after it
// was read is skipped instead of being overwritten with a stale cleaned copy.
const UPDATE_UNCHANGED_ROWS_SQL = `
  WITH written_books AS (
    UPDATE text_entries AS entry
    SET content = change.cleaned
    FROM unnest($1::int[], $2::text[], $3::text[]) AS change(id, original, cleaned)
    WHERE entry.id = change.id AND entry.content = change.original
    RETURNING entry.id
  ), written_bookmarks AS (
    UPDATE bookmarks AS bookmark
    SET bookmark_text = change.cleaned
    FROM unnest($4::int[], $5::text[], $6::text[]) AS change(id, original, cleaned)
    WHERE bookmark.id = change.id AND bookmark.bookmark_text = change.original
    RETURNING bookmark.id
  )
  SELECT ARRAY(SELECT id FROM written_books) AS book_ids, ARRAY(SELECT id FROM written_bookmarks) AS bookmark_ids`;

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

function changeColumns(changes: TextChange[]): [number[], string[], string[]] {
  return [changes.map(({ id }) => id), changes.map(({ original }) => original), changes.map(({ cleaned }) => cleaned)];
}

async function main(): Promise<void> {
  const { isProd, shouldApply } = parseCleanupFlags(process.argv.slice(2));
  const { client, host } = connect(isProd);
  await client.connect();

  try {
    const { rows: books } = await client.query<TextEntryRow>('SELECT id, directory, file_name, content FROM text_entries ORDER BY id');
    const { rows: bookmarks } = await client.query<BookmarkRow>(
      'SELECT id, bookmark_text FROM bookmarks WHERE bookmark_text IS NOT NULL ORDER BY id'
    );
    const bookChanges = books
      .map((row) => ({ row, ...cleanBookText(row.content) }))
      .filter(({ row, cleaned }) => cleaned !== row.content);
    const bookmarkChanges = bookmarks
      .map((row) => ({ id: row.id, original: row.bookmark_text, cleaned: cleanBookText(row.bookmark_text).cleaned }))
      .filter(({ original, cleaned }) => cleaned !== original);

    console.log(`${isProd ? 'production' : 'local'} (${host}): ${bookChanges.length} of ${books.length} books need cleaning`);
    bookChanges.forEach(({ row, removedByRule }) => {
      console.log(`  ${row.directory}/${row.file_name}: ${describeRemovals(removedByRule)}`);
    });
    console.log(`${bookmarkChanges.length} of ${bookmarks.length} bookmarks get the same cleaning`);

    if (!shouldApply) {
      console.log('Dry run. Add --apply to write the changes.');
      return;
    }

    const textChanges = bookChanges.map(({ row, cleaned }) => ({ id: row.id, original: row.content, cleaned }));
    const { rows: [written] } = await client.query<{ book_ids: number[]; bookmark_ids: number[] }>(UPDATE_UNCHANGED_ROWS_SQL, [
      ...changeColumns(textChanges),
      ...changeColumns(bookmarkChanges),
    ]);
    console.log(`Updated ${written.book_ids.length} books and ${written.bookmark_ids.length} bookmarks.`);

    const skippedCount = textChanges.length + bookmarkChanges.length - written.book_ids.length - written.bookmark_ids.length;
    if (skippedCount > 0) {
      throw new Error(`Skipped ${skippedCount} rows that changed after they were read. Run the script again.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
