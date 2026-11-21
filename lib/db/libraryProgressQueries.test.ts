import { describe, expect, it, vi } from 'vitest';
import { recountRow, type ContentRow, type LibraryRow } from './libraryProgressQueries.sql';

vi.mock('@/lib/db/connection', () => ({ sql: vi.fn() }));

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
