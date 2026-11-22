import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { writeCleanedRows } from './clean-book-text';

interface SentStatement {
  text: string;
  values: unknown[];
}

const CONFLICT = Object.assign(new Error('change conflicts with another transaction (OC000)'), { code: '40001' });

// Answers each UPDATE with the ids whose original text still matches, like the compare-and-set does.
function fakeClient(changedSinceRead: number[] = [], outcomes: (Error | null)[] = []) {
  const sent: SentStatement[] = [];
  const query = vi.fn(async (text: string, values: unknown[]) => {
    sent.push({ text, values });
    const outcome = outcomes.shift() ?? null;
    if (outcome) throw outcome;
    const ids = (Array.isArray(values[0]) ? values[0] : [values[0]]) as number[];
    return { rows: ids.filter((id) => !changedSinceRead.includes(id)).map((id) => ({ id })) };
  });
  return { client: { query } as unknown as Pick<Client, 'query'>, sent };
}

const BOOKS = [
  { id: 1, original: 'あ\r\n', cleaned: 'あ\n' },
  { id: 2, original: 'い<bos>', cleaned: 'い' },
];
const BOOKMARKS = [{ id: 7, original: 'あ\r\n', cleaned: 'あ\n' }];

describe('writeCleanedRows', () => {
  it('writes each book in a compare-and-set statement of its own, then the bookmarks in one', async () => {
    const { client, sent } = fakeClient();

    const written = await writeCleanedRows(client, { books: BOOKS, bookmarks: BOOKMARKS });

    expect(written).toEqual({ bookIds: [1, 2], bookmarkIds: [7] });
    expect(sent.map(({ text }) => /UPDATE (\w+)/.exec(text)?.[1])).toEqual(['text_entries', 'text_entries', 'bookmarks']);
    expect(sent[0].values).toEqual([1, 'あ\r\n', 'あ\n']);
  });

  // On Aurora DSQL the library recounts only a book whose content_bytes is NULL.
  it('clears content_bytes with the new text, so the library recounts the cleaned book', async () => {
    const { client, sent } = fakeClient();

    await writeCleanedRows(client, { books: BOOKS.slice(0, 1), bookmarks: [] });

    expect(sent[0].text).toMatch(/SET content = \$3, content_bytes = NULL\s/);
  });

  it('leaves out a book that changed after it was read', async () => {
    const { client } = fakeClient([2]);

    expect(await writeCleanedRows(client, { books: BOOKS, bookmarks: [] })).toEqual({ bookIds: [1], bookmarkIds: [] });
  });

  it('sends no bookmark statement when no bookmark changes', async () => {
    const { client, sent } = fakeClient();

    await writeCleanedRows(client, { books: BOOKS, bookmarks: [] });

    expect(sent).toHaveLength(2);
  });

  it('sends a book again after a write conflict (40001)', async () => {
    const { client, sent } = fakeClient([], [CONFLICT]);

    const written = await writeCleanedRows(client, { books: BOOKS.slice(0, 1), bookmarks: [] });

    expect(written.bookIds).toEqual([1]);
    expect(sent).toHaveLength(2);
  });
});
