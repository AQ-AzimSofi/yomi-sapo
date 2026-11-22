import { describe, expect, it } from 'vitest';
import { MAX_WORD_LENGTH, wordDraftFor } from './wordSelection';

const PLAIN_UNIT = '猫が好きだ。犬も好きだ。';
const RUBY_UNIT = '<ruby>焦燥感<rt>しょうそうかん</rt></ruby>に<ruby>駆られた<rt>かられた</rt></ruby>。';
const BRACKET_UNIT = '彼は咄嗟[とっさ]に動いた。';

describe('wordDraftFor', () => {
  it('saves the selected word with the sentence it sits in and the whole unit', () => {
    expect(wordDraftFor(PLAIN_UNIT, { selectedText: '犬', textBefore: '猫が好きだ。' })).toEqual({
      word: '犬',
      reading: '',
      sentence: '犬も好きだ。',
      paragraphText: PLAIN_UNIT,
    });
  });

  it('reads a word that is exactly one ruby element and keeps the sentence furigana', () => {
    expect(wordDraftFor(RUBY_UNIT, { selectedText: '焦燥感', textBefore: '' })).toEqual({
      word: '焦燥感',
      reading: 'しょうそうかん',
      sentence: RUBY_UNIT,
      paragraphText: '焦燥感に駆られた。',
    });
  });

  it('reads a word written in the bracket form', () => {
    expect(wordDraftFor(BRACKET_UNIT, { selectedText: '咄嗟', textBefore: '彼は' })).toMatchObject({
      word: '咄嗟',
      reading: 'とっさ',
      sentence: BRACKET_UNIT,
      paragraphText: '彼は咄嗟に動いた。',
    });
  });

  it('joins the readings of whole ruby words that sit side by side', () => {
    const unit = '<ruby>人間<rt>にんげん</rt></ruby><ruby>関係<rt>かんけい</rt></ruby>が希薄だ。';

    expect(wordDraftFor(unit, { selectedText: '人間関係', textBefore: '' })?.reading).toBe('にんげんかんけい');
  });

  it('reads one ruby element that holds several base and reading pairs', () => {
    const unit = '<ruby>提<rt>ちょう</rt>灯<rt>ちん</rt></ruby>が揺れる。';

    expect(wordDraftFor(unit, { selectedText: '提灯', textBefore: '' })?.reading).toBe('ちょうちん');
  });

  it('gives no reading when the selection runs past a ruby word', () => {
    expect(wordDraftFor(BRACKET_UNIT, { selectedText: '咄嗟に', textBefore: '彼は' })).toMatchObject({
      word: '咄嗟に',
      reading: '',
    });
  });

  it('gives no reading for part of a ruby word', () => {
    expect(wordDraftFor(RUBY_UNIT, { selectedText: '焦燥', textBefore: '' })).toMatchObject({ word: '焦燥', reading: '' });
  });

  it('finds the copy of a repeated word that was selected', () => {
    const unit = 'はい。はい、と言った。';

    expect(wordDraftFor(unit, { selectedText: 'はい', textBefore: 'はい。' })?.sentence).toBe('はい、と言った。');
  });

  it('counts a copy that overlaps the selection when finding which copy was selected', () => {
    const unit = '<ruby>あ<rt>い</rt></ruby><ruby>あ<rt>う</rt></ruby><ruby>あ<rt>え</rt></ruby>。';

    expect(wordDraftFor(unit, { selectedText: 'ああ', textBefore: '' })?.reading).toBe('いう');
    expect(wordDraftFor(unit, { selectedText: 'ああ', textBefore: 'あ' })?.reading).toBe('うえ');
  });

  it('trims the spaces around the selection', () => {
    expect(wordDraftFor(PLAIN_UNIT, { selectedText: ' 犬 ', textBefore: '猫が好きだ。' })).toMatchObject({
      word: '犬',
      sentence: '犬も好きだ。',
    });
  });

  it('keeps every sentence a selection runs across', () => {
    expect(wordDraftFor(PLAIN_UNIT, { selectedText: 'だ。犬', textBefore: '猫が好き' })?.sentence).toBe(PLAIN_UNIT);
  });

  it('finds a word after an illustration and leaves the illustration out of the unit text', () => {
    const unit = '前の文。[IMAGE:a.jpg]後の言葉。';

    expect(wordDraftFor(unit, { selectedText: '言葉', textBefore: '前の文。' })).toEqual({
      word: '言葉',
      reading: '',
      sentence: '後の言葉。',
      paragraphText: '前の文。後の言葉。',
    });
  });

  it('matches a footnote number the reader shows without its tag', () => {
    const unit = '注<sup>1</sup>を見よ。';

    expect(wordDraftFor(unit, { selectedText: '注1', textBefore: '' })?.sentence).toBe(unit);
  });

  it(`accepts up to ${MAX_WORD_LENGTH} characters`, () => {
    const longest = 'あ'.repeat(MAX_WORD_LENGTH);

    expect(wordDraftFor(`${longest}い。`, { selectedText: longest, textBefore: '' })?.word).toBe(longest);
    expect(wordDraftFor(`${longest}あ。`, { selectedText: `${longest}あ`, textBefore: '' })).toBeNull();
  });

  it('counts a kanji outside the basic plane as one character', () => {
    const word = '𠮷'.repeat(MAX_WORD_LENGTH);

    expect(wordDraftFor(`${word}。`, { selectedText: word, textBefore: '' })?.word).toBe(word);
  });

  it.each([
    ['blank', '  '],
    ['a line break', '好き\nだ'],
    ['only punctuation', '。'],
  ])('offers nothing for a selection that is %s', (_, selectedText) => {
    expect(wordDraftFor('好き\nだ。', { selectedText, textBefore: '' })).toBeNull();
  });

  it('offers nothing for text the unit does not hold, such as its translation', () => {
    expect(wordDraftFor(PLAIN_UNIT, { selectedText: 'dog', textBefore: 'I like cats. A ' })).toBeNull();
  });
});
