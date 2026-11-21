import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferenceValue, subscribeToPreferences } from './preferences';
import { starredWordsPreference, toggleSavedStarredWord, toggleStarredWord } from './starredWords';

const BOOK_WORDS = starredWordsPreference('bookv2-furigana', 'theme-fixture');

describe('starredWordsPreference', () => {
  it('keeps a book under the key the starred words have always used', () => {
    expect(BOOK_WORDS.key).toBe('starred_words_bookv2-furigana_theme-fixture');
  });

  it('reads the saved words in the order they were starred', () => {
    expect([...preferenceValue(BOOK_WORDS, '["窓","練習"]')]).toStrictEqual(['窓', '練習']);
  });

  it('starts a book with nothing saved with no starred words', () => {
    expect(preferenceValue(BOOK_WORDS, null).size).toBe(0);
  });

  it.each(['not json', '{"窓":true}', '"窓"', '3'])('reads the unusable value %s as no starred words', (stored) => {
    expect(preferenceValue(BOOK_WORDS, stored).size).toBe(0);
  });

  it('skips entries that are not words', () => {
    expect([...preferenceValue(BOOK_WORDS, '["窓",1,null]')]).toStrictEqual(['窓']);
  });

  it('saves the words as a JSON array', () => {
    expect(BOOK_WORDS.serialize(new Set(['窓', '練習']))).toBe('["窓","練習"]');
  });
});

describe('toggleStarredWord', () => {
  it('adds a word to the end', () => {
    expect([...toggleStarredWord(new Set(['窓']), '練習')]).toStrictEqual(['窓', '練習']);
  });

  it('removes a starred word and keeps the order of the rest', () => {
    expect([...toggleStarredWord(new Set(['窓', '練習', '素直']), '練習')]).toStrictEqual(['窓', '素直']);
  });

  it('leaves the words it was given unchanged', () => {
    const words = new Set(['窓']);

    toggleStarredWord(words, '練習');

    expect([...words]).toStrictEqual(['窓']);
  });
});

describe('toggleSavedStarredWord', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function storageWith(stored: string) {
    const saved = new Map([[BOOK_WORDS.key, stored]]);
    return { saved, getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) };
  }

  it('adds the word to the words already saved and tells every reader of the starred words', () => {
    const storage = storageWith('["窓"]');
    const onChange = vi.fn();
    const unsubscribe = subscribeToPreferences(onChange);

    toggleSavedStarredWord(storage, BOOK_WORDS, '素直');
    unsubscribe();

    expect([storage.saved.get(BOOK_WORDS.key), onChange.mock.calls.length]).toStrictEqual(['["窓","素直"]', 1]);
  });

  it('removes a saved word and keeps the rest', () => {
    const storage = storageWith('["窓","素直"]');

    toggleSavedStarredWord(storage, BOOK_WORDS, '窓');

    expect(storage.saved.get(BOOK_WORDS.key)).toBe('["素直"]');
  });
});
