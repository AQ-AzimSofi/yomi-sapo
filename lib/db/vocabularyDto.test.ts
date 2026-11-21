import { describe, expect, it } from 'vitest';
import type { VocabularyRow } from './schema';
import { toVocabularyDto } from './vocabularyDto';

const ROW: VocabularyRow = {
  id: 'entry-1',
  word: '言葉',
  reading: 'ことば',
  sentence: '言葉を選ぶ。',
  file_name: 'ほん-rephrase-furigana',
  directory: 'bookv2-furigana/ほん',
  paragraph_text: '言葉を選ぶ。それから話す。',
  notes: 'メモ',
  created_at: new Date('2026-01-02T03:04:05.006Z'),
  updated_at: new Date('2026-01-03T00:00:00.000Z'),
};

describe('toVocabularyDto', () => {
  it('renames every column to the camelCase field the vocabulary page reads', () => {
    expect(toVocabularyDto(ROW)).toStrictEqual({
      id: 'entry-1',
      word: '言葉',
      reading: 'ことば',
      sentence: '言葉を選ぶ。',
      fileName: 'ほん-rephrase-furigana',
      directory: 'bookv2-furigana/ほん',
      paragraphText: '言葉を選ぶ。それから話す。',
      notes: 'メモ',
      createdAt: '2026-01-02T03:04:05.006Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('keeps empty optional columns as null', () => {
    const entry = toVocabularyDto({ ...ROW, reading: null, paragraph_text: null, notes: null });

    expect(entry).toMatchObject({ reading: null, paragraphText: null, notes: null });
  });
});
