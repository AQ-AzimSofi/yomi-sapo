import { describe, expect, it } from 'vitest';
import { PAGINATION_CONFIG } from '@/lib/constants';
import {
  MAX_LINKED_SENTENCE_LENGTH,
  SAVED_SENTENCE_PARAM,
  SAVED_WORD_PARAM,
  locateSavedWord,
  savedWordFrom,
  vocabularySourceHref,
} from './sourceLink';

const ENTRY = {
  directory: 'bookv2-furigana',
  fileName: '俺にトラウマを与えた女子達がチラチラ見てくるけど、残念ですが手遅れです 1',
  word: '焦燥感',
  sentence: '<ruby>焦燥感<rt>しょうそうかん</rt></ruby>に駆られた。',
};

function linkParams(href: string): URLSearchParams {
  return new URL(href, 'http://localhost').searchParams;
}

// Units filling the first page, so the next unit opens page 2.
const FIRST_PAGE = Array.from({ length: PAGINATION_CONFIG.ITEMS_PER_PAGE }, (_, index) => `第${index}文。`);

describe('vocabularySourceHref', () => {
  it('opens the reader on the book with the word and its sentence without furigana', () => {
    const href = vocabularySourceHref(ENTRY);

    expect(href.startsWith('/read?')).toBe(true);
    expect(Object.fromEntries(linkParams(href))).toEqual({
      directory: ENTRY.directory,
      fileName: ENTRY.fileName,
      [SAVED_WORD_PARAM]: '焦燥感',
      [SAVED_SENTENCE_PARAM]: '焦燥感に駆られた。',
    });
  });

  it('leaves the page to the reader, which finds the sentence', () => {
    expect(linkParams(vocabularySourceHref(ENTRY)).has('page')).toBe(false);
  });

  it(`keeps only the first ${MAX_LINKED_SENTENCE_LENGTH} characters of a long sentence`, () => {
    const sentence = `${'長'.repeat(MAX_LINKED_SENTENCE_LENGTH)}い文。`;

    expect(linkParams(vocabularySourceHref({ ...ENTRY, sentence })).get(SAVED_SENTENCE_PARAM)).toBe(
      '長'.repeat(MAX_LINKED_SENTENCE_LENGTH)
    );
  });

  it('gives back the saved word the reader reads from the link', () => {
    const params = linkParams(vocabularySourceHref(ENTRY));

    expect(savedWordFrom(params.get(SAVED_WORD_PARAM), params.get(SAVED_SENTENCE_PARAM))).toEqual({
      word: '焦燥感',
      sentence: '焦燥感に駆られた。',
    });
  });
});

describe('savedWordFrom', () => {
  it('reads no saved word without a word', () => {
    expect(savedWordFrom(null, '焦燥感に駆られた。')).toBeNull();
    expect(savedWordFrom('', '焦燥感に駆られた。')).toBeNull();
  });

  it('keeps a word that came without its sentence', () => {
    expect(savedWordFrom('焦燥感', null)).toEqual({ word: '焦燥感', sentence: '' });
  });
});

describe('locateSavedWord', () => {
  it('finds the unit holding the sentence, ignoring furigana and line breaks, and its page', () => {
    const units = [...FIRST_PAGE, '前の文。', '彼は<ruby>焦燥感<rt>しょうそうかん</rt></ruby>に\n駆られた。'];

    expect(locateSavedWord(units, { word: '焦燥感', sentence: '焦燥感に駆られた。' })).toEqual({
      unitIndex: FIRST_PAGE.length + 1,
      page: 2,
    });
  });

  it('finds a unit saved whole, as entries saved before the reader rewrite are', () => {
    const unit = '<ruby>居<rt>い</rt></ruby>ても立ってもいられない。焦燥感だ。';

    expect(locateSavedWord(['前。', unit], { word: '焦燥感', sentence: unit })?.unitIndex).toBe(1);
  });

  it('finds a sentence the link cut short', () => {
    const sentence = `${'長'.repeat(MAX_LINKED_SENTENCE_LENGTH)}い文。`;
    const params = linkParams(vocabularySourceHref({ ...ENTRY, word: '長', sentence }));
    const savedWord = savedWordFrom(params.get(SAVED_WORD_PARAM), params.get(SAVED_SENTENCE_PARAM));

    expect(savedWord && locateSavedWord(['前。', sentence], savedWord)?.unitIndex).toBe(1);
  });

  it('takes the first unit holding the sentence', () => {
    expect(locateSavedWord(['はい。', 'はい。'], { word: 'はい', sentence: 'はい。' })?.unitIndex).toBe(0);
  });

  it('looks for the word itself when the link has no sentence', () => {
    expect(locateSavedWord(['前。', '焦燥感だ。'], { word: '焦燥感', sentence: '' })?.unitIndex).toBe(1);
  });

  it('finds nothing when no unit holds the sentence any more', () => {
    expect(locateSavedWord(['前。', '焦燥感だ。'], { word: '焦燥感', sentence: '焦燥感に駆られた。' })).toBeNull();
  });
});
