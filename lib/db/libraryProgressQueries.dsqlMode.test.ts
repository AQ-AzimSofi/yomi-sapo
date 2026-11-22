import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db/connection';
import { getLibraryRows, type LibraryRow } from './libraryProgressQueries.sql';

vi.mock('@/lib/db/connection', () => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }), databaseKind: 'dsql' }));

const BOOK_TEXT = Array.from({ length: 60 }, (_, unit_i) => `文${unit_i}。`).join('\n\n');
const BOOK_BYTES = Buffer.byteLength(BOOK_TEXT);

type Transaction = ReturnType<typeof vi.fn>;

// On DSQL the book list selects content_bytes as current_bytes, since it does not read the text.
function listedRow(contentBytes: number | null): LibraryRow {
  return {
    id: 1,
    file_name: 'ほん',
    directory: 'd',
    created_at: '2026-01-01',
    total_pages: 9,
    total_characters: 9,
    content_bytes: contentBytes,
    current_bytes: contentBytes,
    bookmark_text: null,
    bookmark_page: null,
    bookmark_updated_at: null,
  };
}

function queryText(call: unknown[]): string {
  return (call[0] as string[]).join('?');
}

function runTransactionsOn(transaction: Transaction): void {
  vi.mocked(sql.begin).mockImplementation(((callback: (tx: Transaction) => unknown) => Promise.resolve(callback(transaction))) as never);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('getLibraryRows on Aurora DSQL', () => {
  it('lists the books without reading their text, so the covering index answers', async () => {
    vi.mocked(sql).mockResolvedValueOnce([listedRow(BOOK_BYTES)] as never);

    await getLibraryRows(() => true);

    const listQuery = queryText(vi.mocked(sql).mock.calls[0]);
    expect(listQuery).not.toMatch(/\bcontent\b(?!_bytes)/);
    expect(listQuery).toContain('t.content_bytes AS current_bytes');
  });

  it('trusts a counted book, whose text every write would have marked uncounted', async () => {
    vi.mocked(sql).mockResolvedValueOnce([listedRow(BOOK_BYTES)] as never);

    const [row] = await getLibraryRows(() => true);

    expect(row.total_pages).toBe(9);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(sql.begin).not.toHaveBeenCalled();
  });

  it('recounts a book whose text was written since it was counted', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);
    vi.mocked(sql)
      .mockResolvedValueOnce([listedRow(null)] as never)
      .mockResolvedValueOnce([{ id: 1, content: BOOK_TEXT, character_count: BOOK_TEXT.length, byte_count: BOOK_BYTES, stored_bytes: BOOK_BYTES }] as never);

    const [row] = await getLibraryRows(() => true);

    expect(row).toMatchObject({ total_pages: 2, content_bytes: BOOK_BYTES, current_bytes: BOOK_BYTES });
    expect(sql.begin).toHaveBeenCalledTimes(1);
  });
});
