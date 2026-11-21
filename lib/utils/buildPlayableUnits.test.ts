import { describe, it, expect } from 'vitest';
import { detectContentType, parseReaderItems, buildPlayableUnits } from './buildPlayableUnits';

describe('detectContentType', () => {
  it('detects rephrase text by a >> sub item together with a < heading', () => {
    expect(detectContentType('<原文\n>>要約')).toBe('rephrase');
  });

  it('detects HTML ruby text as furigana', () => {
    expect(detectContentType('<ruby>漢字<rt>かんじ</rt></ruby>を読む')).toBe('furigana');
  });

  it('detects bracket furigana text as furigana', () => {
    expect(detectContentType('漢字[かんじ]を読む')).toBe('furigana');
  });

  it('prefers rephrase when rephrase text also carries ruby', () => {
    expect(detectContentType('< <ruby>漢字<rt>かんじ</rt></ruby>を読む\n>> やさしい文')).toBe('rephrase');
  });

  it('treats text without any markers as plain', () => {
    expect(detectContentType('今日は晴れ。')).toBe('plain');
  });

  it('treats text with < but no >> as plain', () => {
    expect(detectContentType('一 < 二')).toBe('plain');
  });

  it('treats text with >> but no < as plain', () => {
    expect(detectContentType('一 >> 二')).toBe('plain');
  });

  it('treats a bracket with no text before it as plain', () => {
    expect(detectContentType('[注]')).toBe('plain');
  });

  it.todo('detects rephrase text whose headings use the full-width ＜ prefix (bug)');
  it.todo('does not treat text whose only "<" is ruby markup as rephrase (bug)');
  it.todo('scans long text without [ in linear time (bug)');
});

describe('parseReaderItems', () => {
  it('splits plain text into paragraphs on blank lines', () => {
    expect(parseReaderItems('一。\n\n二。')).toEqual([{ text: '一。' }, { text: '二。' }]);
  });

  it('keeps a single line break inside a paragraph', () => {
    expect(parseReaderItems('一。\n二。')).toEqual([{ text: '一。\n二。' }]);
  });

  it('trims paragraphs and drops empty ones', () => {
    expect(parseReaderItems('\n\n  一。 \n\n\n\n二。\n\n')).toEqual([{ text: '一。' }, { text: '二。' }]);
  });

  it('splits furigana text on blank lines and keeps the markup', () => {
    const content = '漢字[かんじ]。\n\n<ruby>本<rt>ほん</rt></ruby>。';

    expect(parseReaderItems(content)).toEqual([
      { text: '漢字[かんじ]。' },
      { text: '<ruby>本<rt>ほん</rt></ruby>。' },
    ]);
  });

  it('parses rephrase text into heads with their sub items', () => {
    const content = '<一\n>>い\n>>イ\n\n<二\n>>に';

    expect(parseReaderItems(content)).toEqual([
      { head: '一', subItems: ['い', 'イ'] },
      { head: '二', subItems: ['に'] },
    ]);
  });

  it('returns no items for empty text', () => {
    expect(parseReaderItems('')).toEqual([]);
  });

  it.todo('splits CRLF text on blank lines like LF text (bug)');
});

describe('buildPlayableUnits', () => {
  it('numbers plain units contiguously from 0', () => {
    const units = buildPlayableUnits('一。\n\n二。\n\n三。');

    expect(units.map((unit) => unit.globalIndex)).toEqual([0, 1, 2]);
  });

  it('numbers rephrase units contiguously from 0', () => {
    const units = buildPlayableUnits('<一\n>>い\n\n<二\n>>に\n\n<三\n>>さん');

    expect(units.map((unit) => unit.globalIndex)).toEqual([0, 1, 2]);
  });

  it('uses each plain paragraph as main text with no sub text', () => {
    expect(buildPlayableUnits('一。\n\n二。')).toEqual([
      { globalIndex: 0, main: '一。', sub: null },
      { globalIndex: 1, main: '二。', sub: null },
    ]);
  });

  it('uses each furigana paragraph as main text with the markup kept', () => {
    expect(buildPlayableUnits('漢字[かんじ]。\n\n本[ほん]。')).toEqual([
      { globalIndex: 0, main: '漢字[かんじ]。', sub: null },
      { globalIndex: 1, main: '本[ほん]。', sub: null },
    ]);
  });

  it('uses the head as main text and the sub item as sub text for rephrase units', () => {
    expect(buildPlayableUnits('<一\n>>い\n\n<二\n>>に')).toEqual([
      { globalIndex: 0, main: '一', sub: 'い' },
      { globalIndex: 1, main: '二', sub: 'に' },
    ]);
  });

  it('uses only the first sub item as sub text when a rephrase unit has several', () => {
    expect(buildPlayableUnits('<一\n>>い\n>>イ')).toEqual([{ globalIndex: 0, main: '一', sub: 'い' }]);
  });

  it('gives a rephrase unit without sub items a null sub text', () => {
    expect(buildPlayableUnits('<一\n\n<二\n>>に')).toEqual([
      { globalIndex: 0, main: '一', sub: null },
      { globalIndex: 1, main: '二', sub: 'に' },
    ]);
  });

  it('joins a rephrase head that spans several lines into one main text', () => {
    expect(buildPlayableUnits('<一\n続き\n>>い')).toEqual([{ globalIndex: 0, main: '一続き', sub: 'い' }]);
  });

  it('returns no units for empty text', () => {
    expect(buildPlayableUnits('')).toEqual([]);
  });

  it.todo('builds the same units from CRLF rephrase text as from LF text, without a trailing \\r (bug)');
});
