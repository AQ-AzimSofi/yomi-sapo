import { describe, expect, it } from 'vitest';
import { EXPLANATION_CONFIG, PAGINATION_CONFIG } from '@/lib/constants';
import { buildExplanationContext, NO_SURROUNDINGS, sentenceSurroundings } from './explanationContext';
import type { ReaderItem } from './bookModel';

const MAX = EXPLANATION_CONFIG.MAX_CONTEXT_SIZE;

function paragraphs(...texts: string[]): ReaderItem[] {
  return texts.map((text) => ({ text }));
}

describe('sentenceSurroundings', () => {
  it('takes the rest of the paragraph and the neighbouring paragraphs on each side', () => {
    const items = paragraphs('前の段落。', '一文目。二文目。三文目。', '次の段落。');

    expect(sentenceSurroundings(items, { unitIndex: 1, sentence: '二文目。', occurrence: 0 })).toEqual({
      before: '前の段落。\n一文目。',
      after: '三文目。\n次の段落。',
    });
  });

  it('strips furigana and illustration markers', () => {
    const items = paragraphs('<ruby>昨日<rt>きのう</rt></ruby>は[IMAGE:a.jpg]雨[あめ]。', '<ruby>今日<rt>きょう</rt></ruby>は晴れ。', '明日[あした]も。');

    expect(sentenceSurroundings(items, { unitIndex: 1, sentence: '<ruby>今日<rt>きょう</rt></ruby>は晴れ。', occurrence: 0 })).toEqual({
      before: '昨日は雨。\n',
      after: '\n明日も。',
    });
  });

  it('uses only the main text of rephrase units', () => {
    const items: ReaderItem[] = [
      { head: '原文の一。', subItems: ['やさしい一。'] },
      { head: '原文の二。', subItems: ['やさしい二。'] },
      { head: '原文の三。', subItems: [] },
    ];

    expect(sentenceSurroundings(items, { unitIndex: 1, sentence: '原文の二。', occurrence: 0 })).toEqual({
      before: '原文の一。\n',
      after: '\n原文の三。',
    });
  });

  it('drops the whitespace around each unit but keeps the line between units', () => {
    const items: ReaderItem[] = [
      { head: ' 前の文。 ', subItems: [] },
      { head: ' 文。 後の文。 ', subItems: [] },
      { head: ' 次の文。', subItems: [] },
    ];

    expect(sentenceSurroundings(items, { unitIndex: 1, sentence: '文。', occurrence: 0 })).toEqual({
      before: '前の文。\n',
      after: ' 後の文。\n次の文。',
    });
  });

  it('leaves nothing before a sentence that opens the page', () => {
    const items = paragraphs(...Array.from({ length: PAGINATION_CONFIG.ITEMS_PER_PAGE + 2 }, (_, index) => `段落${index}。`));
    const pageStart = PAGINATION_CONFIG.ITEMS_PER_PAGE;

    expect(sentenceSurroundings(items, { unitIndex: pageStart, sentence: `段落${pageStart}。`, occurrence: 0 })).toEqual({
      before: '',
      after: `\n段落${pageStart + 1}。`,
    });
  });

  it('leaves nothing after a sentence that closes the page', () => {
    const items = paragraphs(...Array.from({ length: PAGINATION_CONFIG.ITEMS_PER_PAGE + 2 }, (_, index) => `段落${index}。`));
    const pageEnd = PAGINATION_CONFIG.ITEMS_PER_PAGE - 1;

    expect(sentenceSurroundings(items, { unitIndex: pageEnd, sentence: `段落${pageEnd}。`, occurrence: 0 }).after).toBe('');
  });

  it('keeps the characters nearest the sentence, up to the maximum on each side', () => {
    const items = paragraphs(`${'古'.repeat(MAX)}近い前。`, '文。', `近い後。${'先'.repeat(MAX)}`);

    const { before, after } = sentenceSurroundings(items, { unitIndex: 1, sentence: '文。', occurrence: 0 });

    expect([...before]).toHaveLength(MAX);
    expect(before.endsWith('近い前。\n')).toBe(true);
    expect([...after]).toHaveLength(MAX);
    expect(after.startsWith('\n近い後。')).toBe(true);
  });

  it('counts a character outside the basic plane as one', () => {
    const items = paragraphs(`${'𠮷'.repeat(MAX + 1)}`, '文。');

    expect(sentenceSurroundings(items, { unitIndex: 1, sentence: '文。', occurrence: 0 }).before).toBe(`${'𠮷'.repeat(MAX - 1)}\n`);
  });

  it('reads around the clicked unit when another unit repeats the sentence', () => {
    const items = paragraphs('はい。', '一つ目の後。', 'はい。', '二つ目の後。');

    expect(sentenceSurroundings(items, { unitIndex: 2, sentence: 'はい。', occurrence: 0 })).toEqual({
      before: 'はい。\n一つ目の後。\n',
      after: '\n二つ目の後。',
    });
  });

  it('reads around the clicked copy when its unit repeats the sentence', () => {
    const items = paragraphs('はい。そうか。はい。分かった。');

    expect(sentenceSurroundings(items, { unitIndex: 0, sentence: 'はい。', occurrence: 1 })).toEqual({
      before: 'はい。そうか。',
      after: '分かった。',
    });
  });

  it('never takes the end of a longer sentence for the clicked one', () => {
    const items = paragraphs('それはいい。いい。終わり。');

    expect(sentenceSurroundings(items, { unitIndex: 0, sentence: 'いい。', occurrence: 0 })).toEqual({
      before: 'それはいい。',
      after: '終わり。',
    });
  });

  it('never takes the start of a longer sentence for a closing one without a full stop', () => {
    const items = paragraphs('よい日だ。よ');

    expect(sentenceSurroundings(items, { unitIndex: 0, sentence: 'よ', occurrence: 0 })).toEqual({
      before: 'よい日だ。',
      after: '',
    });
  });

  it('finds a sentence that follows an illustration', () => {
    const items = paragraphs('前。[IMAGE:a.jpg]後の文。');

    expect(sentenceSurroundings(items, { unitIndex: 0, sentence: '後の文。', occurrence: 0 })).toEqual({
      before: '前。',
      after: '',
    });
  });

  it('gives no surroundings for a sentence the unit does not hold', () => {
    expect(sentenceSurroundings(paragraphs('一文目。'), { unitIndex: 0, sentence: '別の文。', occurrence: 0 })).toEqual(NO_SURROUNDINGS);
    expect(sentenceSurroundings(paragraphs('一文目。'), { unitIndex: 3, sentence: '一文目。', occurrence: 0 })).toEqual(NO_SURROUNDINGS);
  });
});

describe('buildExplanationContext', () => {
  const surroundings = { before: '一二三四五', after: '六七八九十' };

  it('places the sentence between the nearest characters before and after it', () => {
    expect(buildExplanationContext({ sentence: '文。', surroundings, contextSize: 2 })).toBe('四五文。六七');
  });

  it('grows with the context size', () => {
    expect(buildExplanationContext({ sentence: '文。', surroundings, contextSize: 4 })).toBe('二三四五文。六七八九');
  });

  it('sends the sentence without furigana', () => {
    expect(buildExplanationContext({ sentence: ' <ruby>文<rt>ぶん</rt></ruby>。 ', surroundings, contextSize: 1 })).toBe('五文。六');
  });

  it('uses only what follows a sentence at the start of the page', () => {
    expect(buildExplanationContext({ sentence: '文。', surroundings: { before: '', after: '六七' }, contextSize: 10 })).toBe('文。六七');
  });

  it('uses only what precedes a sentence at the end of the page', () => {
    expect(buildExplanationContext({ sentence: '文。', surroundings: { before: '四五', after: '' }, contextSize: 10 })).toBe('四五文。');
  });

  it('sends no context when nothing surrounds the sentence', () => {
    expect(buildExplanationContext({ sentence: '文。', surroundings: NO_SURROUNDINGS, contextSize: 50 })).toBe('');
    expect(buildExplanationContext({ sentence: '文。', surroundings: { before: '\n', after: ' ' }, contextSize: 50 })).toBe('');
  });

  it('keeps surroundings that repeat the sentence as they are', () => {
    expect(buildExplanationContext({ sentence: 'はい。', surroundings: { before: 'はい。', after: 'はい。' }, contextSize: 3 })).toBe(
      'はい。はい。はい。'
    );
  });
});
