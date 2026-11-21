import { describe, expect, it } from 'vitest';
import { alignRephrase, parseMarkdown } from './rephrase-output';

const SOURCE = '吾輩は猫である。名前はまだ無い。\n[IMAGE:fig-1.png]\nどこで生れたかとんと見当がつかぬ。';
const FIRST_PAIR = '< 吾輩は猫である。名前はまだ無い。\n>> 私は猫です。名前はありません。';
const IMAGE_PAIR = '< [IMAGE:fig-1.png]\n>> （図）';
const LAST_PAIR = '< どこで生れたかとんと見当がつかぬ。\n>> どこで生まれたか分かりません。';

describe('parseMarkdown', () => {
  it('Test_parseMarkdown_PairsWithFullWidthHead', () => {
    expect(parseMarkdown('＜ 原文\n>> 要約')).toEqual([{ head: '原文', subItems: ['要約'] }]);
  });

  it('Test_parseMarkdown_IgnoresRubyLine', () => {
    expect(parseMarkdown('< 原文\n>> 要約\n<ruby>漢<rt>かん</rt></ruby>')).toEqual([{ head: '原文', subItems: ['要約'] }]);
  });

  it('Test_parseMarkdown_NoPairs', () => {
    expect(parseMarkdown('ただの文章です。')).toEqual([]);
  });
});

describe('alignRephrase', () => {
  it('Test_alignRephrase_DropsPreambleAndSeparator', () => {
    const response = `以下は日本語学習者向けに要約したものです。\n---\n${FIRST_PAIR}\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}\n---`;
    const { text, report } = alignRephrase(SOURCE, response);
    expect(text).toBe(`${FIRST_PAIR}\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}`);
    expect(report.strayLines).toEqual(['以下は日本語学習者向けに要約したものです。', '---', '---']);
  });

  it('Test_alignRephrase_PutsBackSkippedImageMarker', () => {
    const { text, report } = alignRephrase(SOURCE, `${FIRST_PAIR}\n\n${LAST_PAIR}`);
    expect(text).toBe(`${FIRST_PAIR}\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}`);
    expect(report.insertedPassages).toEqual(['[IMAGE:fig-1.png]']);
  });

  it('Test_alignRephrase_RestoresGarbledHead', () => {
    const garbled = '< 吾輩は猫である。名前はまだ無い\n>> 私は猫です。名前はありません。';
    const { text, report } = alignRephrase(SOURCE, `${garbled}\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}`);
    expect(text).toBe(`${FIRST_PAIR}\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}`);
    expect(report.restoredHeadCount).toBe(1);
  });
});
