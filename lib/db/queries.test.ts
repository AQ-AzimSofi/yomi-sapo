import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db/connection';
import { getBookmark, getTextEntryVersion, initializeBookmarksForFiles, upsertBookmark, upsertTextEntry } from './queries';

vi.mock('@/lib/db/connection', () => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }) }));

type Transaction = ReturnType<typeof vi.fn>;

function runTransactionsOn(transaction: Transaction): void {
  vi.mocked(sql.begin).mockImplementation(((callback: (tx: Transaction) => unknown) => Promise.resolve(callback(transaction))) as never);
}

function transactionWrite(transaction: Transaction): unknown[] {
  const [, ...values] = transaction.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return values;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('upsertBookmark', () => {
  it('sends NULL, never undefined, for a bookmark without a page', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目' });

    expect(transactionWrite(transaction)).toEqual(['ほん', 'd', '一文目', null]);
  });

  it('sends the page it was given', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目', bookmarkPage: 7 });

    expect(transactionWrite(transaction)).toEqual(['ほん', 'd', '一文目', 7]);
  });

  it('writes inside a transaction, so a commit-time conflict reaches the caller', async () => {
    runTransactionsOn(vi.fn().mockResolvedValue([]));

    await upsertBookmark({ fileName: 'ほん', directory: 'd', bookmarkText: '一文目' });

    expect(sql).not.toHaveBeenCalled();
    expect(sql.begin).toHaveBeenCalledTimes(1);
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
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await upsertTextEntry('ほん', '< 本文\r\n>> やさしい文\r\n', 'd');

    expect(transactionWrite(transaction)).toContain('< 本文\n>> やさしい文\n');
    expect(transactionWrite(transaction).some((value) => typeof value === 'string' && value.includes('\r'))).toBe(false);
  });

  it('writes inside a transaction, so a commit-time conflict reaches the caller', async () => {
    runTransactionsOn(vi.fn().mockResolvedValue([]));

    await upsertTextEntry('ほん', '本文', 'd');

    expect(sql).not.toHaveBeenCalled();
    expect(sql.begin).toHaveBeenCalledTimes(1);
  });
});

describe('initializeBookmarksForFiles', () => {
  it('reads the existing bookmarks and inserts the missing ones in one transaction', async () => {
    const transaction = vi.fn().mockResolvedValueOnce([{ file_name: 'ある本' }]).mockResolvedValue([]);
    runTransactionsOn(transaction);

    await initializeBookmarksForFiles(['ある本', '新しい本', '次の本'], 'd');

    expect(sql).not.toHaveBeenCalled();
    expect(sql.begin).toHaveBeenCalledTimes(1);
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
