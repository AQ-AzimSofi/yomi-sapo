import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findFormatProblem, findReaderMismatches, sanitizeRephraseResponse } from './rephraseFormat';

const SOURCE = '吾輩は猫である。名前はまだ無い。\n[IMAGE:fig-1.png]\nどこで生れたかとんと見当がつかぬ。';
const FIRST_PAIR = '< 吾輩は猫である。名前はまだ無い。\n>> 私は猫です。名前はありません。';
const IMAGE_PAIR = '< [IMAGE:fig-1.png]\n>> （図）';
const LAST_PAIR = '< どこで生れたかとんと見当がつかぬ。\n>> どこで生まれたか分かりません。';
const CLEAN_TEXT = `${FIRST_PAIR}\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}`;
const PREAMBLE = 'ご提示いただいた文章を、日本語学習者向けに要約します。';

describe('findFormatProblem', () => {
  it('Test_findFormatProblem_WellFormedReply', () => {
    expect(findFormatProblem(CLEAN_TEXT)).toBeUndefined();
  });

  it('Test_findFormatProblem_PreambleAndSeparatorAroundPairs', () => {
    expect(findFormatProblem(`${PREAMBLE}\n---\n${CLEAN_TEXT}\n---`)).toBeUndefined();
  });

  it('Test_findFormatProblem_NoPairs', () => {
    expect(findFormatProblem(`${PREAMBLE}\n申し訳ありません。`)).toMatch(/no < \/ >> pair/);
  });

  it('Test_findFormatProblem_HeadWithoutRephrase', () => {
    expect(findFormatProblem(`< 吾輩は猫である。\n\n${LAST_PAIR}`)).toMatch(/吾輩は猫である。/);
  });
});

describe('sanitizeRephraseResponse', () => {
  it('Test_sanitizeRephraseResponse_DropsPreambleAndSeparatorsAsMetaLines', () => {
    const sanitized = sanitizeRephraseResponse(SOURCE, `${PREAMBLE}\n---\n${CLEAN_TEXT}\n---`);
    expect(sanitized.text).toBe(CLEAN_TEXT);
    expect(sanitized.metaLines).toEqual([PREAMBLE, '---', '---']);
    expect(sanitized.contentLines).toEqual([]);
  });

  it('Test_sanitizeRephraseResponse_ReportsDroppedContentLine', () => {
    const wrapped = `${FIRST_PAIR}\n名前はまだありません。\n\n${IMAGE_PAIR}\n\n${LAST_PAIR}`;
    expect(sanitizeRephraseResponse(SOURCE, wrapped).contentLines).toEqual(['名前はまだありません。']);
  });

  it('Test_sanitizeRephraseResponse_PutsBackDroppedImageMarker', () => {
    const sanitized = sanitizeRephraseResponse(SOURCE, `${FIRST_PAIR}\n\n${LAST_PAIR}`);
    expect(sanitized.text).toBe(CLEAN_TEXT);
    expect(sanitized.missingImageMarkers).toEqual([]);
  });

  it('Test_sanitizeRephraseResponse_ReaderReadsTheSamePairs', () => {
    expect(sanitizeRephraseResponse(SOURCE, CLEAN_TEXT).readerMismatches).toEqual([]);
  });
});

describe('findReaderMismatches', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('Test_findReaderMismatches_FuriganaTextMatches', () => {
    expect(findReaderMismatches('< <ruby>猫<rt>ねこ</rt></ruby>である。\n>> <ruby>猫<rt>ねこ</rt></ruby>です。')).toEqual([]);
  });

  it('Test_findReaderMismatches_UnprefixedHeadTheReaderRepairs', () => {
    expect(findReaderMismatches('猫である。\n>> 猫です。\n>> 補足\n>> 注')).toEqual(['the reader reads 1 pair(s) where the pipeline wrote 0']);
  });
});
