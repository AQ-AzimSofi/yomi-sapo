import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { isSafeBookRef, rubyRegistryKey } from '../../lib/books/bookRef';
import { isUndefinedTable } from '../../lib/db/errorCode';
import { retryOnSerializationFailure } from '../../lib/db/writeTransaction';
import { isRubyEntrySource } from '../../lib/rubyEntrySource';
import { isNonEmptyString, isRecord } from '../../lib/utils/typeGuards';

export const RUBY_REGISTRY_FILE = 'ruby-registry.json';
export const DEFAULT_IMPORT_ROOT = 'public';

// The VARCHAR(255) columns of ruby_registry_entries.
const MAX_COLUMN_CHARS = 255;
// Aurora DSQL allows 3,000 rows per transaction; registry rows are a few dozen bytes each.
const MAX_ROWS_PER_INSERT = 500;

/** A row of ruby_registry_entries as a ruby-registry.json describes it. */
export interface RegistryRow {
  directory: string;
  bookName: string;
  kanji: string;
  // null for a suggestion: a word without a reading yet.
  reading: string | null;
  source: string;
  note: string;
  occurrences: number | null;
}

export interface StoredRegistryRow extends RegistryRow {
  ignored: boolean;
}

export interface RegistryFile {
  // The book folder relative to the import root, with / separators: the BookRef directory.
  bookFolder: string;
  rows: RegistryRow[];
}

export interface ImportArgs {
  root: string;
  isProd: boolean;
  shouldApply: boolean;
}

const KNOWN_FLAGS = ['--prod', '--apply'];

// A misspelled --prod must not fall back to the local database silently.
export function parseImportArgs(args: readonly string[]): ImportArgs {
  const flags = args.filter((arg) => arg.startsWith('--'));
  const folders = args.filter((arg) => !arg.startsWith('--'));
  const unknownFlags = flags.filter((flag) => !KNOWN_FLAGS.includes(flag));
  if (unknownFlags.length > 0) throw new Error(`Unknown arguments: ${unknownFlags.join(' ')}. Only --prod and --apply are accepted.`);
  if (folders.length > 1) throw new Error(`Give one folder, not ${folders.length}: ${folders.join(' ')}`);
  return { root: folders[0] ?? DEFAULT_IMPORT_ROOT, isProd: flags.includes('--prod'), shouldApply: flags.includes('--apply') };
}

function isColumnText(value: unknown): value is string {
  return isNonEmptyString(value) && [...value].length <= MAX_COLUMN_CHARS;
}

function isOccurrenceCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function entryRow(entry: unknown, base: Pick<RegistryRow, 'directory' | 'bookName'>): RegistryRow {
  if (!isRecord(entry) || !isColumnText(entry.kanji) || !isColumnText(entry.reading)) {
    throw new Error(`an entry needs a kanji and a reading of 1 to ${MAX_COLUMN_CHARS} characters: ${JSON.stringify(entry)}`);
  }
  if (!isRubyEntrySource(entry.source)) throw new Error(`entry ${entry.kanji} has an unknown source: ${JSON.stringify(entry.source)}`);
  if (entry.note !== undefined && typeof entry.note !== 'string') throw new Error(`entry ${entry.kanji} has a note that is not text`);
  return { ...base, kanji: entry.kanji, reading: entry.reading, source: entry.source, note: entry.note ?? '', occurrences: null };
}

function suggestionRow(suggestion: unknown, base: Pick<RegistryRow, 'directory' | 'bookName'>): RegistryRow {
  if (!isRecord(suggestion) || !isColumnText(suggestion.kanji) || !isOccurrenceCount(suggestion.occurrences)) {
    throw new Error(`a suggestion needs a kanji and a whole occurrence count: ${JSON.stringify(suggestion)}`);
  }
  return { ...base, kanji: suggestion.kanji, reading: null, source: 'epub', note: '', occurrences: suggestion.occurrences };
}

function listOrEmpty(value: unknown, name: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} is not a list`);
  return value;
}

/**
 * The rows a ruby-registry.json in bookFolder holds, keyed as the reader keys the book's registry.
 * Throws on anything the table could not store or the app would not show, so a bad file stops the
 * import before it writes.
 */
export function parseRegistryFile(bookFolder: string, json: unknown): RegistryFile {
  const book = { directory: bookFolder, fileName: RUBY_REGISTRY_FILE };
  const base = rubyRegistryKey(book);
  if (!isSafeBookRef(book) || !isColumnText(base.directory) || !isColumnText(base.bookName)) {
    throw new Error('the file must sit in a book folder such as bookv2-furigana/<book>, inside the folder given');
  }
  if (!isRecord(json)) throw new Error('the file does not hold a JSON object');
  const rows = [
    ...listOrEmpty(json.entries, 'entries').map((entry) => entryRow(entry, base)),
    ...listOrEmpty(json.suggestions, 'suggestions').map((suggestion) => suggestionRow(suggestion, base)),
  ];
  const repeated = rows.map((row) => row.kanji).filter((kanji, kanjiI, all) => all.indexOf(kanji) !== kanjiI);
  if (repeated.length > 0) throw new Error(`these words appear more than once: ${[...new Set(repeated)].join(', ')}`);
  return { bookFolder, rows };
}

/** Reads and checks every ruby-registry.json under root, in path order. */
export async function readRegistryFiles(root: string): Promise<RegistryFile[]> {
  const paths = (await readdir(root, { recursive: true }))
    .filter((relativePath) => path.basename(relativePath) === RUBY_REGISTRY_FILE)
    .sort();
  return Promise.all(
    paths.map(async (relativePath) => {
      const bookFolder = path.dirname(relativePath).split(path.sep).join('/');
      try {
        return parseRegistryFile(bookFolder, JSON.parse(await readFile(path.join(root, relativePath), 'utf8')));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${path.join(root, relativePath)}: ${reason}`, { cause: error });
      }
    })
  );
}

export interface ImportPlan {
  toInsert: RegistryRow[];
  unchanged: number;
  // Rows the owner deleted or ignored; they stay hidden.
  hidden: number;
  // Rows the database holds in another form, such as an owner's edit; the database's stays.
  kept: RegistryRow[];
}

function rowKey(row: RegistryRow): string {
  return JSON.stringify([row.directory, row.bookName, row.kanji]);
}

function sameContent(a: RegistryRow, b: RegistryRow): boolean {
  return a.reading === b.reading && a.source === b.source && a.note === b.note && a.occurrences === b.occurrences;
}

/**
 * Compares the files with what the database holds. The import only adds the missing rows: it never
 * overwrites a row, so an owner's edit, delete or ignore survives any number of imports.
 */
export function planRegistryImport(fileRows: readonly RegistryRow[], storedRows: readonly StoredRegistryRow[]): ImportPlan {
  const storedByKey = new Map(storedRows.map((row) => [rowKey(row), row]));
  const present = fileRows.flatMap((row) => {
    const stored = storedByKey.get(rowKey(row));
    return stored ? [{ row, stored }] : [];
  });
  const visible = present.filter(({ stored }) => !stored.ignored);
  const changed = visible.filter(({ row, stored }) => !sameContent(row, stored));
  return {
    toInsert: fileRows.filter((row) => !storedByKey.has(rowKey(row))),
    unchanged: visible.length - changed.length,
    hidden: present.length - visible.length,
    kept: changed.map(({ row }) => row),
  };
}

export type QueryClient = Pick<pg.Client, 'query'>;

interface StoredRegistryRecord {
  directory: string;
  book_name: string;
  kanji: string;
  reading: string | null;
  source: string;
  note: string;
  occurrences: number | null;
  ignored: boolean;
}

const SELECT_STORED_ROWS_SQL = `
  SELECT directory, book_name, kanji, reading, source, note, occurrences, ignored
  FROM ruby_registry_entries`;

// ON CONFLICT DO NOTHING: a row that appeared after the plan was made is left as it is.
const INSERT_ROWS_SQL = `
  INSERT INTO ruby_registry_entries (directory, book_name, kanji, reading, source, note, occurrences)
  SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])
  ON CONFLICT (directory, book_name, kanji) DO NOTHING
  RETURNING kanji`;

export async function readStoredRows(client: QueryClient): Promise<StoredRegistryRow[]> {
  try {
    const { rows } = await client.query<StoredRegistryRecord>(SELECT_STORED_ROWS_SQL);
    return rows.map(({ book_name, ...row }) => ({ ...row, bookName: book_name }));
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    throw new Error(
      'The database has no ruby_registry_entries table. Apply the schema first: npm run db:migrate locally, scripts/db/apply-schema-dsql.ts on Aurora DSQL.',
      { cause: error }
    );
  }
}

function insertColumns(rows: readonly RegistryRow[]): unknown[] {
  return [
    rows.map((row) => row.directory),
    rows.map((row) => row.bookName),
    rows.map((row) => row.kanji),
    rows.map((row) => row.reading),
    rows.map((row) => row.source),
    rows.map((row) => row.note),
    rows.map((row) => row.occurrences),
  ];
}

/**
 * Inserts the rows in statements of at most 500, each committed on its own. pg reports an error
 * Aurora DSQL raises at commit, and a write conflict (40001) sends the statement again, which
 * inserts nothing twice. Returns how many rows were inserted.
 */
export async function insertRows(client: QueryClient, rows: readonly RegistryRow[]): Promise<number> {
  const batches = Array.from({ length: Math.ceil(rows.length / MAX_ROWS_PER_INSERT) }, (_, batchI) =>
    rows.slice(batchI * MAX_ROWS_PER_INSERT, (batchI + 1) * MAX_ROWS_PER_INSERT)
  );
  const insertedCounts: number[] = [];
  for (const batch of batches) {
    const { rows: inserted } = await retryOnSerializationFailure(() => client.query(INSERT_ROWS_SQL, insertColumns(batch)));
    insertedCounts.push(inserted.length);
  }
  return insertedCounts.reduce((sum, count) => sum + count, 0);
}

export interface ImportReport {
  plan: ImportPlan;
  // null for a dry run.
  inserted: number | null;
}

/** Plans the import of the files against the database, and with shouldApply inserts the missing rows. */
export async function importRubyRegistry(client: QueryClient, files: readonly RegistryFile[], shouldApply: boolean): Promise<ImportReport> {
  const plan = planRegistryImport(files.flatMap((file) => file.rows), await readStoredRows(client));
  if (!shouldApply) return { plan, inserted: null };
  return { plan, inserted: await insertRows(client, plan.toInsert) };
}

/** One line per book, then the totals, in the words the owner reads them. */
export function describeImport(files: readonly RegistryFile[], report: ImportReport): string[] {
  const { plan, inserted } = report;
  const newKeys = new Set(plan.toInsert.map(rowKey));
  const bookLines = files.map((file) => {
    const newCount = file.rows.filter((row) => newKeys.has(rowKey(row))).length;
    return `  ${file.bookFolder}: ${file.rows.length} words, ${newCount} new`;
  });
  const keptLines = plan.kept.slice(0, 20).map((row) => `    kept as the database has it: ${row.directory}/${row.bookName} ${row.kanji}`);
  const total = files.reduce((sum, file) => sum + file.rows.length, 0);
  const result = inserted === null ? 'Dry run. Add --apply to insert the new rows.' : `Inserted ${inserted} of ${plan.toInsert.length} new rows.`;
  return [
    ...bookLines,
    `${total} words in ${files.length} files: ${plan.toInsert.length} new, ${plan.unchanged} unchanged, ` +
      `${plan.hidden} deleted or ignored by the owner, ${plan.kept.length} different in the database (kept)`,
    ...keptLines,
    result,
  ];
}
