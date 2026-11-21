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

afterEach(() => {
  vi.mocked(sql).mockReset();
});

describe('vocabulary queries', () => {
  it('lists entries in the camelCase shape', async () => {
    vi.mocked(sql).mockResolvedValue([ROW]);

    expect(await getVocabularyEntries({ fileName: ROW.file_name, directory: ROW.directory })).toStrictEqual([ENTRY]);
  });

  it('reads one entry in the camelCase shape', async () => {
    vi.mocked(sql).mockResolvedValue([ROW]);

    expect(await getVocabularyEntryById('entry-1')).toStrictEqual(ENTRY);
  });

  it('returns null for an id that has no entry', async () => {
    vi.mocked(sql).mockResolvedValue([]);

    expect(await getVocabularyEntryById('missing')).toBeNull();
  });

  it('returns a created entry in the camelCase shape', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]).mockResolvedValueOnce([ROW]);

    const entry = await createVocabularyEntry({
      word: ENTRY.word,
      sentence: ENTRY.sentence,
      fileName: ENTRY.fileName,
      directory: ENTRY.directory,
    });

    expect(entry).toStrictEqual(ENTRY);
  });

  it('returns an updated entry in the camelCase shape', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]).mockResolvedValueOnce([ROW]);

    expect(await updateVocabularyEntry('entry-1', { notes: 'メモ' })).toStrictEqual(ENTRY);
  });
});
