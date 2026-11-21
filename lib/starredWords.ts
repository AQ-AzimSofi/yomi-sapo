import { STORAGE_KEYS } from '@/lib/constants';
import { preferenceValue, writePreference, type Preference } from '@/lib/preferences';

const NO_STARRED_WORDS: ReadonlySet<string> = new Set();

function parseStarredWords(stored: string): ReadonlySet<string> | undefined {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return undefined;
    return new Set(parsed.filter((word): word is string => typeof word === 'string'));
  } catch {
    return undefined;
  }
}

/**
 * The words starred in one book, keyed by its ruby registry location and saved as
 * a JSON array in the order they were starred.
 */
export function starredWordsPreference(directory: string, bookName: string): Preference<ReadonlySet<string>> {
  return {
    key: `${STORAGE_KEYS.STARRED_WORDS}_${directory}_${bookName}`,
    defaultValue: NO_STARRED_WORDS,
    parse: parseStarredWords,
    serialize: (words) => JSON.stringify([...words]),
  };
}

export function toggleStarredWord(words: ReadonlySet<string>, word: string): ReadonlySet<string> {
  if (words.has(word)) return new Set([...words].filter((starred) => starred !== word));
  return new Set([...words, word]);
}

/** Stars the word in the book's saved list, or unstars it when it is already there. */
export function toggleSavedStarredWord(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  preference: Preference<ReadonlySet<string>>,
  word: string
): void {
  const saved = preferenceValue(preference, storage.getItem(preference.key));
  writePreference(storage, preference, toggleStarredWord(saved, word));
}
