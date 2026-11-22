import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeImport,
  importRubyRegistry,
  insertRows,
  parseImportArgs,
  parseRegistryFile,
  planRegistryImport,
  readRegistryFiles,
  readStoredRows,
  type QueryClient,
  type RegistryRow,
} from './rubyRegistryImport';

const BOOK_FOLDER = 'bookv2-furigana/感謝脳';
const KEY = { directory: 'bookv2-furigana', bookName: '感謝脳' };
const ENTRY = { kanji: '仙水', reading: 'せん', source: 'epub_smart', note: '' };
const ROW: RegistryRow = { ...KEY, ...ENTRY, occurrences: null };

function fakeClient(answer: (text: string, values?: unknown[]) => unknown[]) {
  const query = vi.fn((text: string, values?: unknown[]) => Promise.resolve({ rows: answer(text, values) }));
  return { client: { query } as unknown as QueryClient, query };
}

function databaseError(code: string): Error {
  return Object.assign(new Error(`database error ${code}`), { code });
}

describe('parseImportArgs', () => {
  it('imports public into the local database as a dry run by default', () => {
    expect(parseImportArgs([])).toEqual({ root: 'public', isProd: false, shouldApply: false });
  });

  it('takes a folder, --prod and --apply in any order', () => {
    expect(parseImportArgs(['--apply', 'C:/books/public', '--prod'])).toEqual({ root: 'C:/books/public', isProd: true, shouldApply: true });
  });

  it.each([
    ['a misspelled flag', ['--prd']],
    ['two folders', ['public', 'other']],
  ])('refuses %s', (_case, args) => {
    expect(() => parseImportArgs(args)).toThrow();
  });
});

describe('parseRegistryFile', () => {
  it('keys each entry as the reader keys the book registry', () => {
    expect(parseRegistryFile(BOOK_FOLDER, { bookTitle: '感謝脳', entries: [ENTRY] })).toEqual({ bookFolder: BOOK_FOLDER, rows: [ROW] });
  });

  it('stores a suggestion as a row without a reading', () => {
    const { rows } = parseRegistryFile(BOOK_FOLDER, { entries: [], suggestions: [{ kanji: '候補', occurrences: 4 }] });

    expect(rows).toEqual([{ ...KEY, kanji: '候補', reading: null, source: 'epub', note: '', occurrences: 4 }]);
  });

  it('reads a missing note as an empty one', () => {
    const { rows } = parseRegistryFile(BOOK_FOLDER, { entries: [{ kanji: '仙水', reading: 'せん', source: 'user' }] });

    expect(rows[0].note).toBe('');
  });

  it.each([
    ['a file straight in a top folder', 'bookv2-furigana', { entries: [ENTRY] }, /book folder/],
    ['a folder that climbs out', 'bookv2-furigana/..', { entries: [ENTRY] }, /book folder/],
    ['a list that is not one', BOOK_FOLDER, { entries: {} }, /entries is not a list/],
    ['an entry without a reading', BOOK_FOLDER, { entries: [{ kanji: '仙水', source: 'user' }] }, /kanji and a reading/],
    ['a word too long for its column', BOOK_FOLDER, { entries: [{ ...ENTRY, kanji: 'あ'.repeat(256) }] }, /kanji and a reading/],
    ['an unknown source', BOOK_FOLDER, { entries: [{ ...ENTRY, source: 'admin' }] }, /unknown source/],
    ['a word listed twice', BOOK_FOLDER, { entries: [ENTRY], suggestions: [{ kanji: '仙水', occurrences: 1 }] }, /仙水/],
  ])('refuses %s', (_case, bookFolder, json, message) => {
    expect(() => parseRegistryFile(bookFolder, json)).toThrow(message);
  });
});

describe('readRegistryFiles', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function rootWith(files: Record<string, unknown>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'ruby-registry-import-'));
    roots.push(root);
    for (const [relativePath, json] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
      await writeFile(path.join(root, relativePath), JSON.stringify(json));
    }
    return root;
  }

  it('finds every ruby-registry.json under the folder and names its book folder with slashes', async () => {
    const root = await rootWith({
      'bookv2-furigana/感謝脳/ruby-registry.json': { entries: [ENTRY] },
      'bookv2-furigana/感謝脳/感謝脳.json': { title: 'not a registry' },
      'bookv3-rephrase/恋/ruby-registry.json': { entries: [] },
    });

    const files = await readRegistryFiles(root);

    expect(files.map((file) => [file.bookFolder, file.rows.length])).toEqual([
      [BOOK_FOLDER, 1],
      ['bookv3-rephrase/恋', 0],
    ]);
  });

  it('names the file that cannot be imported', async () => {
    const root = await rootWith({ 'bookv2-furigana/感謝脳/ruby-registry.json': { entries: [{ kanji: '仙水' }] } });

    await expect(readRegistryFiles(root)).rejects.toThrow(/感謝脳.ruby-registry\.json: an entry needs/);
  });
});

describe('planRegistryImport', () => {
  const stored = (row: RegistryRow, ignored = false) => ({ ...row, ignored });

  it('inserts every row of an empty table', () => {
    expect(planRegistryImport([ROW], [])).toEqual({ toInsert: [ROW], unchanged: 0, hidden: 0, kept: [] });
  });

  it('changes nothing when the rows are already there, so a second run is a no-op', () => {
    expect(planRegistryImport([ROW], [stored(ROW)])).toEqual({ toInsert: [], unchanged: 1, hidden: 0, kept: [] });
  });

  it("keeps the owner's edit instead of the file's reading", () => {
    expect(planRegistryImport([ROW], [stored({ ...ROW, reading: 'せんすい', source: 'user' })]).kept).toEqual([ROW]);
  });

  it('leaves a word the owner deleted or ignored hidden', () => {
    expect(planRegistryImport([ROW], [stored(ROW, true)])).toEqual({ toInsert: [], unchanged: 0, hidden: 1, kept: [] });
  });

  it('tells the same word in two books apart', () => {
    const otherBook = { ...ROW, bookName: '別の本' };

    expect(planRegistryImport([ROW, otherBook], [stored(ROW)]).toInsert).toEqual([otherBook]);
  });
});

describe('readStoredRows', () => {
  it('reads every stored row in the import shape', async () => {
    const { client } = fakeClient(() => [{ directory: KEY.directory, book_name: KEY.bookName, ...ENTRY, occurrences: null, ignored: false }]);

    expect(await readStoredRows(client)).toEqual([{ ...ROW, ignored: false }]);
  });

  it('says to apply the schema when the table does not exist', async () => {
    const client = { query: vi.fn().mockRejectedValue(databaseError('42P01')) } as unknown as QueryClient;

    await expect(readStoredRows(client)).rejects.toThrow(/no ruby_registry_entries table. Apply the schema first/);
  });

  it('passes any other error on', async () => {
    const client = { query: vi.fn().mockRejectedValue(databaseError('28P01')) } as unknown as QueryClient;

    await expect(readStoredRows(client)).rejects.toThrow('database error 28P01');
  });
});

describe('insertRows', () => {
  it('inserts in statements of at most 500 rows and counts what was inserted', async () => {
    const rows = Array.from({ length: 1201 }, (_, rowI) => ({ ...ROW, kanji: `語${rowI}` }));
    const { client, query } = fakeClient((_text, values) => (values?.[2] as string[]).map((kanji) => ({ kanji })));

    expect(await insertRows(client, rows)).toBe(1201);
    expect(query.mock.calls.map(([, values]) => (values?.[2] as string[]).length)).toEqual([500, 500, 201]);
  });

  it('sends the statement again after a write conflict', async () => {
    const query = vi.fn().mockRejectedValueOnce(databaseError('40001')).mockResolvedValueOnce({ rows: [{ kanji: ROW.kanji }] });

    expect(await insertRows({ query } as unknown as QueryClient, [ROW])).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('sends no statement for no rows', async () => {
    const { client, query } = fakeClient(() => []);

    expect(await insertRows(client, [])).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('sends a suggestion with a NULL reading and its count', async () => {
    const { client, query } = fakeClient(() => []);

    await insertRows(client, [{ ...ROW, reading: null, occurrences: 4 }]);

    expect(query.mock.calls[0][1]).toEqual([[KEY.directory], [KEY.bookName], [ROW.kanji], [null], [ROW.source], [''], [4]]);
  });
});

describe('importRubyRegistry', () => {
  const FILES = [{ bookFolder: BOOK_FOLDER, rows: [ROW] }];

  it('writes nothing on a dry run', async () => {
    const { client, query } = fakeClient(() => []);

    const report = await importRubyRegistry(client, FILES, false);

    expect(report).toEqual({ plan: { toInsert: [ROW], unchanged: 0, hidden: 0, kept: [] }, inserted: null });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('inserts the new rows with --apply', async () => {
    const { client } = fakeClient((text) => (text.includes('INSERT') ? [{ kanji: ROW.kanji }] : []));

    expect((await importRubyRegistry(client, FILES, true)).inserted).toBe(1);
  });

  it('describes each book and the totals', () => {
    const lines = describeImport(FILES, { plan: { toInsert: [ROW], unchanged: 0, hidden: 0, kept: [] }, inserted: 1 });

    expect(lines).toEqual([
      `  ${BOOK_FOLDER}: 1 words, 1 new`,
      '1 words in 1 files: 1 new, 0 unchanged, 0 deleted or ignored by the owner, 0 different in the database (kept)',
      'Inserted 1 of 1 new rows.',
    ]);
  });
});
