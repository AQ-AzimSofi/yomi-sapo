import { describe, expect, it } from 'vitest';
import { copyTextForPages } from './copyText';

const pageOf = (label: string) => Array.from({ length: 50 }, (_, unit_i) => `${label}${unit_i}。`);

describe('copyTextForPages', () => {
  it('joins the units of one page line by line', () => {
    expect(copyTextForPages(['一。', '二。'], 1, 1)).toBe('一。\n二。');
  });

  it('copies only the units of the pages in the range', () => {
    const units = [...pageOf('a'), ...pageOf('b'), ...pageOf('c')];

    const lines = copyTextForPages(units, 2, 3).split('\n');

    expect([lines.length, lines[0], lines[99]]).toStrictEqual([100, 'b0。', 'c49。']);
  });

  it('drops the furigana of HTML ruby and bracket readings', () => {
    expect(copyTextForPages(['<ruby>漢字<rt>かんじ</rt></ruby>を読む。', '本[ほん]。'], 1, 1)).toBe('漢字を読む。\n本。');
  });

  it('leaves out a unit that is only an illustration marker', () => {
    expect(copyTextForPages(['一。', '[IMAGE:0006-1.png]', '二。'], 1, 1)).toBe('一。\n二。');
  });

  it('leaves out an illustration marker line inside a paragraph', () => {
    expect(copyTextForPages(['一。\n[IMAGE:kuchie-001.jpg]\n二。'], 1, 1)).toBe('一。\n二。');
  });

  it('keeps the text that shares a line with an illustration marker', () => {
    expect(copyTextForPages(['[IMAGE:00002.gif]<ruby>集中<rt>しゅうちゅう</rt></ruby>する。'], 1, 1)).toBe('集中する。');
  });

  it('leaves out a marker line padded with spaces', () => {
    expect(copyTextForPages(['一。', ' [IMAGE:cover.jpg] ', '二。'], 1, 1)).toBe('一。\n二。');
  });

  it('copies nothing from a page of illustrations only', () => {
    expect(copyTextForPages(['[IMAGE:a.png]', '[IMAGE:b.png]'], 1, 1)).toBe('');
  });

  it('keeps brackets that are not illustration markers', () => {
    expect(copyTextForPages(['[注]を見る。'], 1, 1)).toBe('[注]を見る。');
  });
});
