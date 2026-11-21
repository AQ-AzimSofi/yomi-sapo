import type { VocabularyRow } from './schema';
import type { VocabularyEntry } from '@/lib/types';

export function toVocabularyDto(row: VocabularyRow): VocabularyEntry {
  return {
    id: row.id,
    word: row.word,
    reading: row.reading,
    sentence: row.sentence,
    fileName: row.file_name,
    directory: row.directory,
    paragraphText: row.paragraph_text,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
