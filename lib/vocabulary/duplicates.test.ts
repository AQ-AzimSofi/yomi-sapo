import { describe, expect, it } from 'vitest';
import { isSameSavedWord } from './duplicates';

const SAVED = {
  word: '言葉',
  sentence: '<ruby>言葉<rt>ことば</rt></ruby>を選ぶ。',
  directory: 'bookv2-furigana/ほん',
  fileName: 'ほん-rephrase-furigana',
};

describe('isSameSavedWord', () => {
  it('matches the same word from the same sentence of the same book', () => {
    expect(isSameSavedWord(SAVED, { ...SAVED })).toBe(true);
  });

  it('compares sentences without their furigana or line breaks', () => {
    expect(isSameSavedWord(SAVED, { ...SAVED, sentence: '言葉[ことば]を\n選ぶ。' })).toBe(true);
  });

  it.each([
    ['another word', { word: '選ぶ' }],
    ['another sentence', { sentence: '言葉を探す。' }],
    ['another book', { fileName: 'べつ-rephrase-furigana' }],
    ['another directory', { directory: 'bookv2-furigana/べつ' }],
  ])('tells %s apart', (_, change) => {
    expect(isSameSavedWord(SAVED, { ...SAVED, ...change })).toBe(false);
  });
});
