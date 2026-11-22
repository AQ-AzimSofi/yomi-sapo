import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from './connection';
import { getRubyRegistry, hideRubyRegistryItem, saveRubyRegistryEntry } from './rubyRegistryQueries.sql';

vi.mock('./connection', () => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }) }));

const KEY = { directory: 'bookv2-furigana', bookName: 'ほん' };
const ENTRY = { kanji: '仙水', reading: 'せんすい', source: 'user' as const, note: 'メモ' };

function runTransactionsOn(transaction: ReturnType<typeof vi.fn>): void {
  vi.mocked(sql.begin).mockImplementation(((callback: (tx: typeof transaction) => unknown) => Promise.resolve(callback(transaction))) as never);
}

function queryText(strings: readonly string[]): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('getRubyRegistry', () => {
  it('lists words with a reading as entries and words without one as suggestions', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      { kanji: '仙水', reading: 'せん', source: 'epub_smart', note: '', occurrences: null },
      { kanji: '候補', reading: null, source: 'epub_smart', note: '', occurrences: 4 },
    ] as never);

    expect(await getRubyRegistry(KEY)).toStrictEqual({
      bookTitle: 'ほん',
      entries: [{ kanji: '仙水', reading: 'せん', source: 'epub_smart', note: '' }],
      suggestions: [{ kanji: '候補', occurrences: 4 }],
    });
  });

  it("reads only the book's rows that are not hidden, in code point order", async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);

    await getRubyRegistry(KEY);

    const [strings, ...values] = vi.mocked(sql).mock.calls[0] as unknown as [string[], ...unknown[]];
    expect(queryText(strings)).toContain('WHERE directory = ? AND book_name = ? AND NOT ignored ORDER BY kanji COLLATE "C"');
    expect(values).toEqual(['bookv2-furigana', 'ほん']);
  });
});

describe('saveRubyRegistryEntry', () => {
  it('writes inside a transaction, so a commit-time conflict reaches the caller', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await saveRubyRegistryEntry(KEY, ENTRY);

    expect(sql).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0].slice(1)).toEqual(['bookv2-furigana', 'ほん', '仙水', 'せんすい', 'user', 'メモ']);
  });

  it('shows a hidden word again when it is saved', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await saveRubyRegistryEntry(KEY, ENTRY);

    expect(queryText(transaction.mock.calls[0][0])).toContain('ignored = FALSE');
  });
});

describe('hideRubyRegistryItem', () => {
  it.each([
    ['entry', false],
    ['suggestion', true],
  ] as const)('hides only a %s, inside a transaction', async (type, isSuggestion) => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await hideRubyRegistryItem(KEY, '仙水', type);

    expect(sql).not.toHaveBeenCalled();
    expect(queryText(transaction.mock.calls[0][0])).toContain('SET ignored = TRUE');
    expect(transaction.mock.calls[0].slice(1)).toEqual(['bookv2-furigana', 'ほん', '仙水', isSuggestion]);
  });
});
