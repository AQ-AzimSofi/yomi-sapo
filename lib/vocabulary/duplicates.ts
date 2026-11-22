import { sameBook } from '@/lib/books/bookRef';
import { toMatchText } from '@/lib/content/bookModel';
import type { SaveVocabularyRequest } from '@/lib/api/contracts';

type SavedWord = Pick<SaveVocabularyRequest, 'word' | 'sentence' | 'directory' | 'fileName'>;

/**
 * Whether two 単語帳 entries save the same word from the same sentence of the same
 * book; saving one again returns the stored entry instead of a copy. Sentences are
 * compared without furigana, as bookmarks are.
 */
export function isSameSavedWord(saved: SavedWord, draft: SavedWord): boolean {
  return sameBook(saved, draft) && saved.word === draft.word && toMatchText(saved.sentence) === toMatchText(draft.sentence);
}
