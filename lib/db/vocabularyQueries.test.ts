import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from './connection';
import {
  createVocabularyEntry,
  getVocabularyEntries,
  getVocabularyEntryById,
  updateVocabularyEntry,
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
    vi.mocked(sql).mockImplementationOnce((_strings, ...values) =>
      values.includes(undefined)
        ? Promise.reject(new Error('UNDEFINED_VALUE: Undefined values are not allowed'))
        : Promise.resolve(rows)
    );
  });
}

function firstQueryText(): string {
  const [strings] = vi.mocked(sql).mock.calls[0];
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

afterEach(() => {
  vi.mocked(sql).mockReset();
});

describe('vocabulary queries', () => {
  it('lists entries in the camelCase shape', async () => {
    answerQueries([ROW]);

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

  it.todo('keeps the columns an update leaves out, such as the sentence and paragraphText the PUT route never sends, instead of passing undefined to the driver (bug)');
});
