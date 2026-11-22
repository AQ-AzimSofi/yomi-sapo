import { databaseKind, sql } from './connection';
import { runWriteTransaction } from './writeTransaction';
import { groupBySize } from '@/lib/utils/groupBySize';
import {
  itemMainText,
  locateBookmark,
  parseReaderItems,
  totalPagesFor,
  type ReaderItem,
} from '@/lib/content/bookModel';

/**
 * Per-book data for the library cards, without reading the books' text.
 *
 * All book text together is tens of MB, so the counts the cards need are cached in
 * text_entries.total_pages / total_characters and bookmarks.bookmark_page. A book's
 * cache is stale when text_entries.content_bytes (the size it was counted at) is NULL,
 * which every write of new text sets, or differs from octet_length(content): any edit
 * or appended chunk changes the size, and on PostgreSQL octet_length reads it from the
 * value's header without the text. Aurora DSQL has to read the whole stored text for
 * it, so there the list trusts content_bytes alone and reads only idx_text_entries_library.
 * A moved bookmark is stale when it was saved without a page (bookmark_page is NULL).
 * Only stale books' text is fetched, recounted and written back.
 */
export interface LibraryRow {
  id: number;
  file_name: string;
  directory: string;
  created_at: string;
  total_pages: number | null;
  total_characters: number | null;
  content_bytes: number | null;
  // NULL only on DSQL, for a book not counted since its text was written.
  current_bytes: number | null;
  bookmark_text: string | null;
  bookmark_page: number | null;
  bookmark_updated_at: string | null;
}

export interface ContentRow {
  id: number;
  content: string;
  character_count: number;
  byte_count: number;
  stored_bytes: number;
}

// Records "computed, but the bookmark text is not in the book" so it is not retried.
const BOOKMARK_NOT_FOUND = 0;

// Aurora DSQL refuses a transaction that writes more than 10 MiB, and its UPDATE rewrites
// the whole stored row, book text included, even when only a count changes. 8 MiB of
// stored text leaves room for the rest of each row and for the bookmark rows.
const MAX_STORED_BYTES_PER_TRANSACTION = 8 * 1024 * 1024;

function bookmarkPageOf(bookmarkText: string, items: ReaderItem[], savedPage: number | null): number {
  return locateBookmark(items.map(itemMainText), bookmarkText, savedPage).page ?? BOOKMARK_NOT_FOUND;
}

function hasStaleTextCounts(row: LibraryRow): boolean {
  return row.content_bytes === null || row.content_bytes !== row.current_bytes;
}

// Recomputed whenever the text is recounted, even on a guest's request: recounting
// refreshes content_bytes, which would otherwise hide that the bookmark page is stale.
function needsBookmarkPage(row: LibraryRow): boolean {
  if (!row.bookmark_text) return false;
  return row.bookmark_page === null || hasStaleTextCounts(row);
}

export function recountRow(row: LibraryRow, content: ContentRow): LibraryRow {
  const items = parseReaderItems(content.content);
  return {
    ...row,
    total_pages: totalPagesFor(items.length),
    total_characters: content.character_count,
    content_bytes: content.byte_count,
    current_bytes: content.byte_count,
    bookmark_page: needsBookmarkPage(row) ? bookmarkPageOf(row.bookmark_text ?? '', items, row.bookmark_page) : row.bookmark_page,
  };
}

async function saveRecountedGroup(recounted: LibraryRow[], bookmarkRows: LibraryRow[]): Promise<void> {
  await runWriteTransaction(sql, async (tx) => {
    // The text was read before this transaction. A book rewritten since then no longer has
    // the size it was counted at, so it keeps its uncounted state for the next load.
    await tx`
      UPDATE text_entries AS t
      SET total_pages = u.total_pages, total_characters = u.total_characters, content_bytes = u.content_bytes
      FROM unnest(
        ${recounted.map((row) => row.id)}::int[],
        ${recounted.map((row) => row.total_pages)}::int[],
        ${recounted.map((row) => row.total_characters)}::int[],
        ${recounted.map((row) => row.content_bytes)}::int[]
      ) AS u(id, total_pages, total_characters, content_bytes)
      WHERE t.id = u.id AND octet_length(t.content) = u.content_bytes
    `;
    if (bookmarkRows.length === 0) return;
    // Matching bookmark_text skips a bookmark that moved while this request ran, so
    // the page of its old position never overwrites the page saved with the new one.
    await tx`
      UPDATE bookmarks AS b
      SET bookmark_page = u.bookmark_page
      FROM unnest(
        ${bookmarkRows.map((row) => row.file_name)}::text[],
        ${bookmarkRows.map((row) => row.directory)}::text[],
        ${bookmarkRows.map((row) => row.bookmark_text)}::text[],
        ${bookmarkRows.map((row) => row.bookmark_page)}::int[]
      ) AS u(file_name, directory, bookmark_text, bookmark_page)
      WHERE b.file_name = u.file_name AND b.directory = u.directory AND b.bookmark_text = u.bookmark_text
    `;
  });
}

// A book's counts and its bookmark page commit together, so a saved recount never hides a stale bookmark page.
async function saveRecountedRows(
  recounted: LibraryRow[],
  bookmarkRows: LibraryRow[],
  storedBytesOf: (row: LibraryRow) => number
): Promise<void> {
  const bookmarkIds = new Set(bookmarkRows.map((row) => row.id));
  for (const group of groupBySize(recounted, storedBytesOf, MAX_STORED_BYTES_PER_TRANSACTION)) {
    await saveRecountedGroup(group, group.filter((row) => bookmarkIds.has(row.id)));
  }
}

async function refreshStaleRows(rows: LibraryRow[]): Promise<LibraryRow[]> {
  const staleRows = rows.filter((row) => hasStaleTextCounts(row) || needsBookmarkPage(row));
  if (staleRows.length === 0) return rows;

  const contentRows = await sql<ContentRow[]>`
    SELECT id, content, char_length(content) AS character_count, octet_length(content) AS byte_count,
           pg_column_size(content) AS stored_bytes
    FROM text_entries
    WHERE id = ANY(${staleRows.map((row) => row.id)}::int[])
  `;
  const contentById = new Map(contentRows.map((content) => [content.id, content]));
  const recounted = staleRows
    .filter((row) => contentById.has(row.id))
    .map((row) => recountRow(row, contentById.get(row.id) as ContentRow));
  const recountedById = new Map(recounted.map((row) => [row.id, row]));
  const bookmarkRows = staleRows
    .filter((row) => needsBookmarkPage(row) && recountedById.has(row.id))
    .map((row) => recountedById.get(row.id) as LibraryRow);

  await saveRecountedRows(recounted, bookmarkRows, (row) => contentById.get(row.id)?.stored_bytes ?? 0);
  return rows.map((row) => recountedById.get(row.id) ?? row);
}

function selectLibraryRows() {
  if (databaseKind === 'dsql') {
    return sql<LibraryRow[]>`
      SELECT
        t.id, t.file_name, t.directory, t.created_at, t.total_pages, t.total_characters, t.content_bytes,
        t.content_bytes AS current_bytes,
        b.bookmark_text, b.bookmark_page, b.updated_at AS bookmark_updated_at
      FROM text_entries t
      LEFT JOIN bookmarks b ON t.file_name = b.file_name AND t.directory = b.directory
    `;
  }
  return sql<LibraryRow[]>`
    SELECT
      t.id, t.file_name, t.directory, t.created_at, t.total_pages, t.total_characters, t.content_bytes,
      octet_length(t.content) AS current_bytes,
      b.bookmark_text, b.bookmark_page, b.updated_at AS bookmark_updated_at
    FROM text_entries t
    LEFT JOIN bookmarks b ON t.file_name = b.file_name AND t.directory = b.directory
  `;
}

/**
 * Library rows with up-to-date page counts and bookmark pages. `isVisible` limits
 * which books are returned (and therefore recounted); callers decide what to expose.
 */
export async function getLibraryRows(isVisible: (row: LibraryRow) => boolean): Promise<LibraryRow[]> {
  const rows = await selectLibraryRows();
  return refreshStaleRows(rows.filter(isVisible));
}
