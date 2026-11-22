import { sql } from './connection';
import { runWriteTransaction } from './writeTransaction';
import type { RubyEntry, RubyRegistry } from '@/lib/types';
import type { RubyEntrySource } from '@/lib/rubyEntrySource';
import type { RubyRegistryItemType, RubyRegistryKey } from '@/lib/api/contracts';

interface RubyRegistryRow {
  kanji: string;
  reading: string | null;
  source: RubyEntrySource;
  note: string;
  occurrences: number | null;
}

// A row without a reading is a suggestion (see lib/db/schema.ts).
function toRubyRegistry(bookName: string, rows: readonly RubyRegistryRow[]): RubyRegistry {
  return {
    bookTitle: bookName,
    entries: rows.flatMap(({ kanji, reading, source, note }) => (reading === null ? [] : [{ kanji, reading, source, note }])),
    suggestions: rows.flatMap(({ kanji, reading, occurrences }) => (reading === null ? [{ kanji, occurrences: occurrences ?? 0 }] : [])),
  };
}

/**
 * The book's registry without the hidden rows, in code point order (COLLATE "C"), which is the
 * order Aurora DSQL and a local PostgreSQL with another collation agree on.
 */
export async function getRubyRegistry(key: RubyRegistryKey): Promise<RubyRegistry> {
  const rows = await sql<RubyRegistryRow[]>`
    SELECT kanji, reading, source, note, occurrences
    FROM ruby_registry_entries
    WHERE directory = ${key.directory} AND book_name = ${key.bookName} AND NOT ignored
    ORDER BY kanji COLLATE "C"
  `;
  return toRubyRegistry(key.bookName, rows);
}

/** Adds or replaces the word's entry, which also turns a suggestion or a hidden row into an entry. */
export async function saveRubyRegistryEntry(key: RubyRegistryKey, entry: RubyEntry): Promise<void> {
  await runWriteTransaction(sql, async (tx) => {
    await tx`
      INSERT INTO ruby_registry_entries (directory, book_name, kanji, reading, source, note)
      VALUES (${key.directory}, ${key.bookName}, ${entry.kanji}, ${entry.reading}, ${entry.source}, ${entry.note})
      ON CONFLICT (directory, book_name, kanji) DO UPDATE SET
        reading = EXCLUDED.reading,
        source = EXCLUDED.source,
        note = EXCLUDED.note,
        occurrences = NULL,
        ignored = FALSE,
        updated_at = CURRENT_TIMESTAMP
    `;
  });
}

/**
 * Hides the word's entry (a delete) or suggestion (an ignore). The row stays, so importing the
 * book's ruby-registry.json again does not bring the word back.
 */
export async function hideRubyRegistryItem(key: RubyRegistryKey, kanji: string, type: RubyRegistryItemType): Promise<void> {
  await runWriteTransaction(sql, async (tx) => {
    await tx`
      UPDATE ruby_registry_entries
      SET ignored = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE directory = ${key.directory} AND book_name = ${key.bookName} AND kanji = ${kanji}
        AND (reading IS NULL) = ${type === 'suggestion'} AND NOT ignored
    `;
  });
}
