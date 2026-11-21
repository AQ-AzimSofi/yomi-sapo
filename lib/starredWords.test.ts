import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferenceValue, subscribeToPreferences, writePreference } from './preferences';
import { starredWordsPreference, toggleStarredWord } from './starredWords';

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

describe('starring a word', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves the new list and tells every reader of the starred words', () => {
    const saved = new Map<string, string>();
    const onChange = vi.fn();
    const unsubscribe = subscribeToPreferences(onChange);

    writePreference({ setItem: (key, value) => saved.set(key, value) }, BOOK_WORDS, toggleStarredWord(new Set(['窓']), '素直'));
    unsubscribe();

    expect([saved.get(BOOK_WORDS.key), onChange.mock.calls.length]).toStrictEqual(['["窓","素直"]', 1]);
  });
});
