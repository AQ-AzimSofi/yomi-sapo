import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { syncDirection, TABLES, type TableConfig } from './sync-core';

type Row = Record<string, unknown>;

interface FakeTable {
  columns: string[];
  rows: Row[];
  idDefault: string | null;
}

interface SentStatement {
  text: string;
  values: unknown[];
}

const TEXT_ENTRIES = TABLES.find((table) => table.name === 'text_entries') as TableConfig;
const BOOKMARKS = TABLES.find((table) => table.name === 'bookmarks') as TableConfig;
const BOOK_COLUMNS = ['id', 'file_name', 'directory', 'content', 'total_pages', 'total_characters', 'content_bytes', 'created_at', 'updated_at'];
const SERIAL_ID = "nextval('text_entries_id_seq'::regclass)";
const UPDATED_AT = new Date('2026-11-21T10:00:00Z');

function book(fileName: string, content: string, overrides: Row = {}): Row {
  return {
    id: 1,
    file_name: fileName,
    directory: 'bookv2-furigana',
    content,
    total_pages: 1,
    total_characters: content.length,
    content_bytes: Buffer.byteLength(content),
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function databaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function keyOf(row: Row, keyColumns: readonly string[]): string {
  return JSON.stringify(keyColumns.map((column) => row[column]));
}

// Answers the statements syncDirection sends, from an in-memory table. Each INSERT is recorded and
// answered by the next queued outcome, or by "every row written".
function fakeClient(table: FakeTable, insertOutcomes: (Error | null)[] = []) {
  const inserts: SentStatement[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes('information_schema.columns') && text.includes('column_default')) {
      return { rows: table.idDefault === null ? [] : [{ column_default: table.idDefault }] };
    }
    if (text.includes('information_schema.columns')) {
      return { rows: table.columns.map((column_name) => ({ column_name })) };
    }
    if (text.includes('as sync_ts')) {
      return { rows: table.rows.map((row) => ({ ...row, sync_ts: String((row.updated_at as Date).getTime()) })) };
    }
    if (text.startsWith('SELECT * FROM')) {
      const keyColumns = /WHERE \(([^)]+)\)/.exec(text)?.[1].split(', ').map((column) => column.replace(/"/g, '')) ?? [];
      const wanted = new Set(
        Array.from({ length: values.length / keyColumns.length }, (_, rowI) =>
          JSON.stringify(values.slice(rowI * keyColumns.length, (rowI + 1) * keyColumns.length))
        )
      );
      return { rows: table.rows.filter((row) => wanted.has(keyOf(row, keyColumns))) };
    }
    if (text.startsWith('INSERT INTO')) {
      inserts.push({ text, values });
      const outcome = insertOutcomes.shift() ?? null;
      if (outcome) throw outcome;
      const columnCount = /\(([^)]*)\) VALUES/.exec(text)?.[1].split(', ').length ?? 1;
      return { rowCount: values.length / columnCount };
    }
    throw new Error(`fake client got an unexpected statement: ${text}`);
  });
  return { client: { query } as unknown as Client, inserts };
}

function emptyTarget(idDefault: string | null = SERIAL_ID): FakeTable {
  return { columns: BOOK_COLUMNS, rows: [], idDefault };
}

function insertedColumns(statement: SentStatement): string[] {
  return (/\(([^)]*)\) VALUES/.exec(statement.text)?.[1] ?? '').split(', ').map((column) => column.replace(/"/g, ''));
}

function insertedRows(statement: SentStatement): Row[] {
  const columns = insertedColumns(statement);
  return Array.from({ length: statement.values.length / columns.length }, (_, rowI) =>
    Object.fromEntries(columns.map((column, columnI) => [column, statement.values[rowI * columns.length + columnI]]))
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncDirection', () => {
  it('copies the rows the target lacks', async () => {
    const source = fakeClient({ columns: BOOK_COLUMNS, rows: [book('a', 'あ'), book('b', 'い', { id: 2 })], idDefault: SERIAL_ID });
    const target = fakeClient(emptyTarget());

    const result = await syncDirection(source.client, target.client, TEXT_ENTRIES, 'local -> prod');

    expect(result).toEqual({ table: 'text_entries', rows: 2, skipped: 0, failed: 0, direction: 'local -> prod' });
  });

  it('stops at an over-long message (08P01), which also drops the connection, instead of retrying row by row', async () => {
    const source = fakeClient({ columns: BOOK_COLUMNS, rows: [book('a', 'あ'), book('b', 'い', { id: 2 })], idDefault: SERIAL_ID });
    const target = fakeClient(emptyTarget(), [databaseError('08P01', 'invalid message length')]);

    await expect(syncDirection(source.client, target.client, TEXT_ENTRIES, 'local -> prod')).rejects.toThrow(/08P01/);
    expect(target.inserts).toHaveLength(1);
  });

  it('sends a statement again after a write conflict (40001), which committed nothing', async () => {
    const source = fakeClient({ columns: BOOK_COLUMNS, rows: [book('a', 'あ'), book('b', 'い', { id: 2 })], idDefault: SERIAL_ID });
    const target = fakeClient(emptyTarget(), [databaseError('40001', 'change conflicts with another transaction (OC000)')]);

    const result = await syncDirection(source.client, target.client, TEXT_ENTRIES, 'local -> prod');

    expect(result.rows).toBe(2);
    expect(target.inserts).toHaveLength(2);
    expect(target.inserts[1]).toEqual(target.inserts[0]);
  });
});
