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

import type pg from 'pg';
import dotenv from 'dotenv';
import { createPgClient } from '../../lib/db/pgClient';
import { PROD_DATABASE_VARIABLES, prodClientConfig, prodHostOf, readProdDatabase } from '../../lib/db/prodDatabase';
import { cleanBookText } from './bookTextCleanup';
import { parseCleanupFlags } from './cleanupFlags';
import { isEntryPoint } from '../shared/entryPoint';

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
// Clearing content_bytes has the library recount the book, which on Aurora DSQL
// it does only for a book whose content_bytes is NULL.
const UPDATE_UNCHANGED_ROWS_SQL = `
  WITH written_books AS (
    UPDATE text_entries AS entry
    SET content = change.cleaned, content_bytes = NULL
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

function connectToProd(): Connection {
  const prodDatabase = readProdDatabase(process.env);
  if (!prodDatabase) throw new Error(`${PROD_DATABASE_VARIABLES} is not set in .env.local`);
  return { client: createPgClient(prodClientConfig(prodDatabase), 'production'), host: prodHostOf(prodDatabase) };
}

function connectToLocal(): Connection {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env.local');
  return { client: createPgClient({ connectionString }, 'local'), host: new URL(connectionString).hostname };
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
  const { client, host } = isProd ? connectToProd() : connectToLocal();
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

if (isEntryPoint(import.meta.url)) {
  dotenv.config({ path: '.env.local' });
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
