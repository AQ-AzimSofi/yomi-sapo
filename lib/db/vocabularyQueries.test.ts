import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from './connection';
import {
  createVocabularyEntry,
  getVocabularyEntries,
  getVocabularyEntryById,
  updateVocabularyEntry,
  type VocabularyFilter,
} from './vocabularyQueries.sql';

vi.mock('./connection', () => ({ sql: vi.fn() }));

const ROW = {
  id: 'entry-1',
  word: '言葉',
  reading: null,
  sentence: '言葉を選ぶ。',
  file_name: 'ほん-rephrase-furigana',
  directory: 'bookv2-furigana/ほん',
  paragraph_text: '言葉を選ぶ。それから話す。',
  notes: null,
  created_at: new Date('2026-01-02T03:04:05.006Z'),
  updated_at: new Date('2026-01-02T03:04:05.006Z'),
};

const ENTRY = {
  id: 'entry-1',
  word: '言葉',
  reading: null,
  sentence: '言葉を選ぶ。',
  fileName: 'ほん-rephrase-furigana',
  directory: 'bookv2-furigana/ほん',
  paragraphText: '言葉を選ぶ。それから話す。',
  notes: null,
  createdAt: '2026-01-02T03:04:05.006Z',
  updatedAt: '2026-01-02T03:04:05.006Z',
};

const CREATE_INPUT = {
  word: ENTRY.word,
  reading: 'ことば',
  sentence: ENTRY.sentence,
  fileName: ENTRY.fileName,
  directory: ENTRY.directory,
  paragraphText: ENTRY.paragraphText,
  notes: 'メモ',
};

const UPDATE_INPUT = {
  word: ENTRY.word,
  reading: 'ことば',
  sentence: ENTRY.sentence,
  paragraphText: ENTRY.paragraphText,
  notes: 'メモ',
};

// postgres.js throws UNDEFINED_VALUE for an undefined parameter (connection.ts sets no transform.undefined), so the mock must too.
function answerQueries(...results: object[][]): void {
  results.forEach((rows) => {
    vi.mocked(sql).mockImplementationOnce(((_strings: TemplateStringsArray, ...values: unknown[]) =>
      values.includes(undefined)
        ? Promise.reject(new Error('UNDEFINED_VALUE: Undefined values are not allowed'))
        : Promise.resolve(rows)) as never
    );
  });
}

function firstQueryText(): string {
  const [strings] = vi.mocked(sql).mock.calls[0];
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

interface RecordedQuery {
  strings: readonly string[];
  values: readonly unknown[];
}

interface RenderedQuery {
  text: string;
  params: unknown[];
}

// Each call keeps its template on the returned promise, so a fragment passed into a later query can be inlined.
function recordQueries(rows: object[]): void {
  vi.mocked(sql).mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) =>
    Object.assign(Promise.resolve(rows), { strings, values })) as never);
}

function isRecordedQuery(value: unknown): value is RecordedQuery {
  return typeof value === 'object' && value !== null && 'strings' in value;
}

// Inlines nested fragments as postgres.js does and leaves a ? for each parameter.
function renderQuery({ strings, values }: RecordedQuery): RenderedQuery {
  return values.reduce<RenderedQuery>(
    (rendered, value, value_i) => {
      const inlined = isRecordedQuery(value) ? renderQuery(value) : { text: '?', params: [value] };
      return { text: rendered.text + inlined.text + strings[value_i + 1], params: [...rendered.params, ...inlined.params] };
    },
    { text: strings[0], params: [] }
  );
}

function lastQuery(): RenderedQuery {
  const [strings, ...values] = vi.mocked(sql).mock.lastCall as unknown as [TemplateStringsArray, ...unknown[]];
  const { text, params } = renderQuery({ strings, values });
  return { text: text.replace(/\s+/g, ' ').trim(), params };
}

function selectEntriesWhere(conditions: string): string {
  return conditions === ''
    ? 'SELECT * FROM vocabulary_entries ORDER BY created_at DESC'
    : `SELECT * FROM vocabulary_entries WHERE ${conditions} ORDER BY created_at DESC`;
}

const WORD_PATTERN = `%${ROW.word}%`;
const CREATED_TODAY = 'created_at >= ? AND created_at <= ?';
const TODAY_BOUNDS = [expect.any(Date), expect.any(Date)];

const FILTER_CASES: [string, VocabularyFilter, string, unknown[]][] = [
  ['no filter', {}, '', []],
  ['the route with no query parameters', { word: undefined, fileName: undefined, directory: undefined, today: false }, '', []],
  ['today', { today: true }, CREATED_TODAY, TODAY_BOUNDS],
  ['word', { word: ROW.word }, 'word ILIKE ?', [WORD_PATTERN]],
  ['fileName', { fileName: ROW.file_name }, 'file_name = ?', [ROW.file_name]],
  ['directory', { directory: ROW.directory }, 'directory = ?', [ROW.directory]],
  [
    'fileName and directory',
    { fileName: ROW.file_name, directory: ROW.directory },
    'file_name = ? AND directory = ?',
    [ROW.file_name, ROW.directory],
  ],
  [
    'word, fileName and directory',
    { word: ROW.word, fileName: ROW.file_name, directory: ROW.directory },
    'word ILIKE ? AND file_name = ? AND directory = ?',
    [WORD_PATTERN, ROW.file_name, ROW.directory],
  ],
  ['today and word', { today: true, word: ROW.word }, `${CREATED_TODAY} AND word ILIKE ?`, [...TODAY_BOUNDS, WORD_PATTERN]],
  [
    'today, fileName and directory',
    { today: true, fileName: ROW.file_name, directory: ROW.directory },
    `${CREATED_TODAY} AND file_name = ? AND directory = ?`,
    [...TODAY_BOUNDS, ROW.file_name, ROW.directory],
  ],
  ['word and fileName', { word: ROW.word, fileName: ROW.file_name }, 'word ILIKE ? AND file_name = ?', [WORD_PATTERN, ROW.file_name]],
  ['word and directory', { word: ROW.word, directory: ROW.directory }, 'word ILIKE ? AND directory = ?', [WORD_PATTERN, ROW.directory]],
  ['today and fileName', { today: true, fileName: ROW.file_name }, `${CREATED_TODAY} AND file_name = ?`, [...TODAY_BOUNDS, ROW.file_name]],
  ['today and directory', { today: true, directory: ROW.directory }, `${CREATED_TODAY} AND directory = ?`, [...TODAY_BOUNDS, ROW.directory]],
  [
    'today, word and fileName',
    { today: true, word: ROW.word, fileName: ROW.file_name },
    `${CREATED_TODAY} AND word ILIKE ? AND file_name = ?`,
    [...TODAY_BOUNDS, WORD_PATTERN, ROW.file_name],
  ],
  [
    'today, word and directory',
    { today: true, word: ROW.word, directory: ROW.directory },
    `${CREATED_TODAY} AND word ILIKE ? AND directory = ?`,
    [...TODAY_BOUNDS, WORD_PATTERN, ROW.directory],
  ],
  [
    'today, word, fileName and directory',
    { today: true, word: ROW.word, fileName: ROW.file_name, directory: ROW.directory },
    `${CREATED_TODAY} AND word ILIKE ? AND file_name = ? AND directory = ?`,
    [...TODAY_BOUNDS, WORD_PATTERN, ROW.file_name, ROW.directory],
  ],
];

afterEach(() => {
  vi.mocked(sql).mockReset();
  vi.useRealTimers();
});

describe('vocabulary queries', () => {
  it('lists entries in the camelCase shape', async () => {
    recordQueries([ROW]);

    expect(await getVocabularyEntries({ fileName: ROW.file_name, directory: ROW.directory })).toStrictEqual([ENTRY]);
  });

  it('reads one entry in the camelCase shape', async () => {
    answerQueries([ROW]);

    expect(await getVocabularyEntryById('entry-1')).toStrictEqual(ENTRY);
  });

  it('returns null for an id that has no entry', async () => {
    answerQueries([]);

    expect(await getVocabularyEntryById('missing')).toBeNull();
  });

  it('returns a created entry in the camelCase shape', async () => {
    answerQueries([], [ROW]);

    const entry = await createVocabularyEntry({
      word: ENTRY.word,
      sentence: ENTRY.sentence,
      fileName: ENTRY.fileName,
      directory: ENTRY.directory,
    });

    expect(entry).toStrictEqual(ENTRY);
  });

  it('inserts each input field into its own column', async () => {
    answerQueries([], [ROW]);

    await createVocabularyEntry(CREATE_INPUT);

    expect(firstQueryText()).toBe(
      'INSERT INTO vocabulary_entries (id, word, reading, sentence, file_name, directory, paragraph_text, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual([
      expect.any(String),
      CREATE_INPUT.word,
      CREATE_INPUT.reading,
      CREATE_INPUT.sentence,
      CREATE_INPUT.fileName,
      CREATE_INPUT.directory,
      CREATE_INPUT.paragraphText,
      CREATE_INPUT.notes,
      expect.any(Date),
      expect.any(Date),
    ]);
  });

  it('returns an updated entry in the camelCase shape', async () => {
    answerQueries([], [ROW]);

    expect(await updateVocabularyEntry('entry-1', UPDATE_INPUT)).toStrictEqual(ENTRY);
  });

  it('sets each input field on its own column', async () => {
    answerQueries([], [ROW]);

    await updateVocabularyEntry('entry-1', UPDATE_INPUT);

    expect(firstQueryText()).toBe(
      'UPDATE vocabulary_entries SET word = COALESCE(?, word), reading = COALESCE(?, reading), sentence = COALESCE(?, sentence), paragraph_text = COALESCE(?, paragraph_text), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?'
    );
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual([
      UPDATE_INPUT.word,
      UPDATE_INPUT.reading,
      UPDATE_INPUT.sentence,
      UPDATE_INPUT.paragraphText,
      UPDATE_INPUT.notes,
      expect.any(Date),
      'entry-1',
    ]);
  });

  it('keeps the columns an update leaves out instead of passing undefined to the driver', async () => {
    answerQueries([], [ROW]);

    await updateVocabularyEntry('entry-1', { notes: 'メモ' });

    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual([null, null, null, null, 'メモ', expect.any(Date), 'entry-1']);
  });
});

describe('getVocabularyEntries filters', () => {
  it.each(FILTER_CASES)('applies %s', async (_name, filter, conditions, params) => {
    recordQueries([]);

    await getVocabularyEntries(filter);

    expect(lastQuery()).toEqual({ text: selectEntriesWhere(conditions), params });
  });

  it('bounds today by the start and end of the local day', async () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 2, 15, 30) });
    recordQueries([]);

    await getVocabularyEntries({ today: true });

    expect(lastQuery().params).toEqual([new Date(2026, 0, 2, 0, 0, 0, 0), new Date(2026, 0, 2, 23, 59, 59, 999)]);
  });
});
