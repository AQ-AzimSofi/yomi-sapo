/**
 * The link from a 単語帳 entry back to the reader. It names the book, the word and
 * the start of its sentence; the reader finds the unit holding that sentence, opens
 * its page and flashes it.
 */

import { pageOfIndex, toMatchText } from '@/lib/content/bookModel';
import type { VocabularyEntry } from '@/lib/types';

export const SAVED_WORD_PARAM = 'highlight';
export const SAVED_SENTENCE_PARAM = 'sentence';
// Enough to tell sentences apart while a link stays far below URL length limits.
export const MAX_LINKED_SENTENCE_LENGTH = 80;

export interface SavedWordQuery {
  word: string;
  /** The sentence without furigana, cut to MAX_LINKED_SENTENCE_LENGTH; empty to look for the word alone. */
  sentence: string;
}

export interface SavedWordLocation {
  unitIndex: number;
  page: number;
}

type SavedWordSource = Pick<VocabularyEntry, 'directory' | 'fileName' | 'word' | 'sentence'>;

/** The reader query naming a saved word and its sentence. */
export function savedWordParams({ word, sentence }: SavedWordQuery): Record<string, string> {
  const linkedSentence = Array.from(toMatchText(sentence)).slice(0, MAX_LINKED_SENTENCE_LENGTH).join('');
  return { [SAVED_WORD_PARAM]: word, [SAVED_SENTENCE_PARAM]: linkedSentence };
}

export function vocabularySourceHref(entry: SavedWordSource): string {
  const params = new URLSearchParams({
    directory: entry.directory,
    fileName: entry.fileName,
    ...savedWordParams(entry),
  });
  return `/read?${params.toString()}`;
}

export function savedWordFrom(word: string | null, sentence: string | null): SavedWordQuery | null {
  if (!word) return null;
  return { word, sentence: sentence ?? '' };
}

/** The first unit holding the saved sentence (the word, without one), compared as bookmarks are. */
export function locateSavedWord(unitMainTexts: readonly string[], { word, sentence }: SavedWordQuery): SavedWordLocation | null {
  const target = toMatchText(sentence) || word;
  const unitIndex = unitMainTexts.findIndex((text) => toMatchText(text).includes(target));
  if (unitIndex === -1) return null;
  return { unitIndex, page: pageOfIndex(unitIndex) };
}
