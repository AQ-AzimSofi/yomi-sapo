import { describe, it, expect } from 'vitest';
import {
  buildPlayableUnits,
  detectContentType,
  findBookmarkIndex,
  itemMainText,
  legacyPageBookmark,
  normalizeNewlines,
  pageOfIndex,
  pageStartIndex,
  parseReaderItems,
  totalPagesFor,
} from './bookModel';

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

  it('detects rephrase text whose headings use the full-width ＜ prefix', () => {
    expect(detectContentType('＜原文\n>>要約')).toBe('rephrase');
  });

  it('scans long text without [ in linear time', () => {
    const longText = 'あ'.repeat(200_000);
    const startedMs = performance.now();

    detectContentType(longText);

    expect(performance.now() - startedMs).toBeLessThan(100);
  });

  it('does not treat text whose only "<" is ruby markup as rephrase', () => {
    expect(detectContentType('<ruby>漢字<rt>かんじ</rt></ruby>\n>>やさしい文')).toBe('furigana');
  });

  it('does not treat prose with ">>" in the middle of a line as rephrase', () => {
    expect(detectContentType('<原文\n矢印>>のある行')).toBe('plain');
  });
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

  it('splits CRLF text on blank lines like LF text', () => {
    expect(parseReaderItems('一。\r\n\r\n二。')).toEqual(parseReaderItems('一。\n\n二。'));
  });
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

  it('builds the same units from CRLF rephrase text as from LF text, without a trailing carriage return', () => {
    const lfText = '<一\n>>い\n\n<二\n>>に';

    expect(buildPlayableUnits(lfText.replace(/\n/g, '\r\n'))).toEqual(buildPlayableUnits(lfText));
  });
});

describe('normalizeNewlines', () => {
  it('turns CRLF and lone CR into LF', () => {
    expect(normalizeNewlines('一\r\n二\r三\n四')).toBe('一\n二\n三\n四');
  });
});

describe('itemMainText', () => {
  it('reads the head of a rephrase item and the text of a paragraph item', () => {
    expect([itemMainText({ head: '頭', subItems: ['い'] }), itemMainText({ text: '段落' })]).toEqual(['頭', '段落']);
  });
});

describe('findBookmarkIndex', () => {
  const mainTexts = ['一つ目。', '<ruby>二<rt>に</rt></ruby>つ目。', '三つ目。', '一つ目。'];

  it('finds the unit whose text matches the bookmark', () => {
    expect(findBookmarkIndex(mainTexts, '三つ目。')).toBe(2);
  });

  it('matches regardless of furigana and line breaks', () => {
    expect(findBookmarkIndex(mainTexts, '二つ\n目。')).toBe(1);
  });

  it('returns the first match when the same text appears twice', () => {
    expect(findBookmarkIndex(mainTexts, '一つ目。')).toBe(0);
  });

  it('returns null for a bookmark that matches no unit', () => {
    expect(findBookmarkIndex(mainTexts, '四つ目。')).toBeNull();
  });

  it('returns null for an empty bookmark', () => {
    expect(findBookmarkIndex(mainTexts, '  ')).toBeNull();
  });
});

describe('legacyPageBookmark', () => {
  it('reads the page of an old page:N bookmark', () => {
    expect(legacyPageBookmark('page:12')).toBe(12);
  });

  it('returns null for a text bookmark', () => {
    expect(legacyPageBookmark('page:12 の話')).toBeNull();
  });
});

describe('page math', () => {
  it('puts the first and fiftieth units on page 1 and the fifty-first on page 2', () => {
    expect([pageOfIndex(0), pageOfIndex(49), pageOfIndex(50)]).toEqual([1, 1, 2]);
  });

  it('starts each page at a multiple of fifty', () => {
    expect([pageStartIndex(1), pageStartIndex(3)]).toEqual([0, 100]);
  });

  it('counts the pages a book of N units needs', () => {
    expect([totalPagesFor(0), totalPagesFor(1), totalPagesFor(50), totalPagesFor(51)]).toEqual([0, 1, 1, 2]);
  });
});
