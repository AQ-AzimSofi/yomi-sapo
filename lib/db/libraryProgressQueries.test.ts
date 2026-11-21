import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db/connection';
import { getLibraryRows, recountRow, type ContentRow, type LibraryRow } from './libraryProgressQueries.sql';

vi.mock('@/lib/db/connection', () => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }) }));

const REPEATED_TEXT = '同じ文。';
// 150 paragraphs: the repeated text sits on page 1 (unit 10) and page 3 (unit 110).
const BOOK_TEXT = Array.from({ length: 150 }, (_, unit_i) => (unit_i === 10 || unit_i === 110 ? REPEATED_TEXT : `文${unit_i}。`)).join('\n\n');

function staleRow(bookmark: Pick<LibraryRow, 'bookmark_text' | 'bookmark_page'>): LibraryRow {
  return {
    id: 1,
    file_name: 'ほん',
    directory: 'd',
    created_at: '2026-01-01',
    total_pages: 1,
    total_characters: 1,
    content_bytes: 1,
    current_bytes: 2,
    bookmark_updated_at: null,
    ...bookmark,
  };
}

const CONTENT: ContentRow = { id: 1, content: BOOK_TEXT, character_count: BOOK_TEXT.length, byte_count: 2 };

function updatedTables(client: { mock: { calls: readonly unknown[][] } }): string[] {
  return client.mock.calls
    .map(([strings]) => /UPDATE (\w+)/.exec((strings as string[]).join('?')))
    .filter((match) => match !== null)
    .map((match) => match[1]);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('recountRow', () => {
  it('keeps the saved page of a bookmark whose text appears on an earlier page too', () => {
    expect(recountRow(staleRow({ bookmark_text: REPEATED_TEXT, bookmark_page: 3 }), CONTENT).bookmark_page).toBe(3);
  });

  it('uses the first copy for a bookmark saved without a page', () => {
    expect(recountRow(staleRow({ bookmark_text: REPEATED_TEXT, bookmark_page: null }), CONTENT).bookmark_page).toBe(1);
  });

  it('opens an old page:N bookmark on its page', () => {
    expect(recountRow(staleRow({ bookmark_text: 'page:2', bookmark_page: null }), CONTENT).bookmark_page).toBe(2);
  });

  it('recounts the total pages of the book', () => {
    expect(recountRow(staleRow({ bookmark_text: null, bookmark_page: null }), CONTENT).total_pages).toBe(3);
  });
});

describe('getLibraryRows', () => {
  function mockStaleBookReads(): void {
    vi.mocked(sql)
      .mockResolvedValueOnce([staleRow({ bookmark_text: REPEATED_TEXT, bookmark_page: null })] as never)
      .mockResolvedValueOnce([CONTENT] as never);
  }

  it('saves the recounted pages and the bookmark page in one transaction', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    vi.mocked(sql.begin).mockImplementation(((callback: (tx: typeof transaction) => unknown) => Promise.resolve(callback(transaction))) as never);
    mockStaleBookReads();

    await getLibraryRows(() => true);

    expect(sql.begin).toHaveBeenCalledTimes(1);
    expect(updatedTables(transaction)).toEqual(['text_entries', 'bookmarks']);
    expect(updatedTables(vi.mocked(sql))).toEqual([]);
  });

  it('saves the recounted rows again after a DSQL write conflict', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    const conflict = Object.assign(new Error('change conflicts with another transaction (OC000)'), { code: '40001' });
    vi.mocked(sql.begin)
      .mockRejectedValueOnce(conflict)
      .mockImplementation(((callback: (tx: typeof transaction) => unknown) => Promise.resolve(callback(transaction))) as never);
    mockStaleBookReads();

    await getLibraryRows(() => true);

    expect(sql.begin).toHaveBeenCalledTimes(2);
    expect(updatedTables(transaction)).toEqual(['text_entries', 'bookmarks']);
  });

  it('fails when the transaction that saves the recounted rows rolls back', async () => {
    vi.mocked(sql.begin).mockRejectedValue(new Error('rolled back'));
    mockStaleBookReads();

    await expect(getLibraryRows(() => true)).rejects.toThrow('rolled back');
  });
});
