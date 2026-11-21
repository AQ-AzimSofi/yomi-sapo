import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db/connection';
import { getBookmark, getTextEntryVersion, initializeBookmarksForFiles, upsertBookmark, upsertTextEntry } from './queries';

vi.mock('@/lib/db/connection', () => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }) }));

function queryValues(): unknown[] {
  const [, ...values] = vi.mocked(sql).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
  return values;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('upsertBookmark', () => {
  it('sends NULL, never undefined, for a bookmark without a page', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目' });

    expect(queryValues()).toEqual(['ほん', 'd', '一文目', null]);
  });

  it('sends the page it was given', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目', bookmarkPage: 7 });

    expect(queryValues()).toEqual(['ほん', 'd', '一文目', 7]);
  });
});

describe('getTextEntryVersion', () => {
  it('returns null for a missing book', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    expect(await getTextEntryVersion('ほん', 'd')).toBeNull();
  });

  it('changes when only the timestamp changes', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ bytes: 10, updated_ms: '100' }] as never);
    vi.mocked(sql).mockResolvedValueOnce([{ bytes: 10, updated_ms: '200' }] as never);

    const first = await getTextEntryVersion('ほん', 'd');
    const second = await getTextEntryVersion('ほん', 'd');

    expect(first).toBe('10-100');
    expect(second).toBe('10-200');
  });
});

describe('upsertTextEntry', () => {
  it('stores Windows (CRLF) text with LF line endings', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    await upsertTextEntry('ほん', '< 本文\r\n>> やさしい文\r\n', 'd');

    expect(queryValues()).toContain('< 本文\n>> やさしい文\n');
    expect(queryValues().some((value) => typeof value === 'string' && value.includes('\r'))).toBe(false);
  });
});

describe('initializeBookmarksForFiles', () => {
  it('reads the existing bookmarks and inserts the missing ones in one transaction', async () => {
    const transaction = vi.fn().mockResolvedValueOnce([{ file_name: 'ある本' }]).mockResolvedValue([]);
    vi.mocked(sql.begin).mockImplementation(((callback: (tx: typeof transaction) => unknown) => Promise.resolve(callback(transaction))) as never);

    await initializeBookmarksForFiles(['ある本', '新しい本', '次の本'], 'd');

    expect(sql).not.toHaveBeenCalled();
    expect(transaction.mock.calls.map(([, ...values]) => values)).toEqual([['d'], ['新しい本', 'd'], ['次の本', 'd']]);
  });
});

describe('getBookmark', () => {
  it('returns the text and the page it was saved on', async () => {
    vi.mocked(sql).mockResolvedValue([{ bookmark_text: '一文目', bookmark_page: 4 }] as never);

    expect(await getBookmark('ほん', 'd')).toEqual({ text: '一文目', page: 4 });
  });

  it('returns an empty bookmark for a book without one', async () => {
    vi.mocked(sql).mockResolvedValue([] as never);

    expect(await getBookmark('ほん', 'd')).toEqual({ text: '', page: null });
  });
});
