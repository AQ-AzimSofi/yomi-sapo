import { describe, it, expect, vi } from 'vitest';
import { truncateToPreviewPages } from './truncatePreview';
import { parseReaderItems } from '@/lib/content/bookModel';
import { PAGINATION_CONFIG } from '@/lib/constants';

const ITEMS_PER_PAGE = 2;
const FIVE_UNIT_REPHRASE = '<一\n>>い\n\n<二\n>>に\n\n<三\n>>さん\n\n<四\n>>よん\n\n<五\n>>ご';
const FIVE_UNIT_PLAIN = '一。\n\n二。\n\n三。\n\n四。\n\n五。';

describe('truncateToPreviewPages', () => {
  it('keeps every item of plain content shorter than the cap', () => {
    const content = '  一。\n\n\n二。\n';

    expect(parseReaderItems(truncateToPreviewPages(content, 2, ITEMS_PER_PAGE))).toEqual(parseReaderItems(content));
  });

  it('keeps every item of rephrase content shorter than the cap', () => {
    const content = '<一\n>>い\n\n\n<二\n>>に\n';

    expect(parseReaderItems(truncateToPreviewPages(content, 2, ITEMS_PER_PAGE))).toEqual(parseReaderItems(content));
  });

  it('keeps every item when the unit count equals the cap', () => {
    const content = '一。\n\n二。';

    expect(truncateToPreviewPages(content, 1, ITEMS_PER_PAGE)).toBe(content);
  });

  it('cuts rephrase content to text that parses back to the first N pages of items', () => {
    const preview = truncateToPreviewPages(FIVE_UNIT_REPHRASE, 2, ITEMS_PER_PAGE);

    expect(parseReaderItems(preview)).toEqual(parseReaderItems(FIVE_UNIT_REPHRASE).slice(0, 2 * ITEMS_PER_PAGE));
  });

  it('round-trips rephrase heads that start with ruby markup', () => {
    const content =
      '＜<ruby>序<rt>じょ</rt></ruby>章\n>> はじまり\n\n' +
      '<ruby>本<rt>ほん</rt></ruby>の話\n>> 本のこと\n>> もう一つ\n\n' +
      '< 三\n>> さん';
    const preview = truncateToPreviewPages(content, 1, ITEMS_PER_PAGE);

    expect(parseReaderItems(content)).toHaveLength(3);
    expect(parseReaderItems(preview)).toEqual(parseReaderItems(content).slice(0, ITEMS_PER_PAGE));
  });

  it('writes cut rephrase content in < head and >> sub form', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_REPHRASE, 1, ITEMS_PER_PAGE)).toBe('<一\n>>い\n\n<二\n>>に');
  });

  it('keeps every sub item of a kept rephrase unit', () => {
    const content = '<一\n>>い\n>>イ\n\n<二\n>>に';

    expect(truncateToPreviewPages(content, 1, 1)).toBe('<一\n>>い\n>>イ');
  });

  it('cuts plain content to text that parses back to the first N pages of items', () => {
    const preview = truncateToPreviewPages(FIVE_UNIT_PLAIN, 2, ITEMS_PER_PAGE);

    expect(parseReaderItems(preview)).toEqual(parseReaderItems(FIVE_UNIT_PLAIN).slice(0, 2 * ITEMS_PER_PAGE));
  });

  it('cuts plain content by paragraph and joins the kept ones with one blank line', () => {
    const content = ' 一。\n二。 \n\n\n三。\n\n四。';

    expect(truncateToPreviewPages(content, 1, ITEMS_PER_PAGE)).toBe('一。\n二。\n\n三。');
  });

  it('cuts furigana content by paragraph and keeps the markup', () => {
    const content = '漢字[かんじ]。\n\n<ruby>本<rt>ほん</rt></ruby>。\n\n三。';

    expect(truncateToPreviewPages(content, 1, ITEMS_PER_PAGE)).toBe('漢字[かんじ]。\n\n<ruby>本<rt>ほん</rt></ruby>。');
  });

  it('uses PAGINATION_CONFIG.ITEMS_PER_PAGE units per page by default', () => {
    const paragraphs = Array.from({ length: PAGINATION_CONFIG.ITEMS_PER_PAGE + 1 }, (_, paragraph_i) => `段落${paragraph_i}。`);
    const preview = truncateToPreviewPages(paragraphs.join('\n\n'), 1);

    expect(preview).toBe(paragraphs.slice(0, PAGINATION_CONFIG.ITEMS_PER_PAGE).join('\n\n'));
  });

  it('returns empty text for a cap of 0 pages', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_REPHRASE, 0, ITEMS_PER_PAGE)).toBe('');
    expect(truncateToPreviewPages(FIVE_UNIT_PLAIN, 0, ITEMS_PER_PAGE)).toBe('');
  });

  it('returns empty text for a negative cap', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_REPHRASE, -1, ITEMS_PER_PAGE)).toBe('');
    expect(truncateToPreviewPages(FIVE_UNIT_PLAIN, -1, ITEMS_PER_PAGE)).toBe('');
  });

  it('returns empty text for a fractional cap below 1 page', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_REPHRASE, 0.9, ITEMS_PER_PAGE)).toBe('');
    expect(truncateToPreviewPages(FIVE_UNIT_PLAIN, 0.9, ITEMS_PER_PAGE)).toBe('');
  });

  it('rounds a fractional cap down to whole pages', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_REPHRASE, 1.9, ITEMS_PER_PAGE)).toBe('<一\n>>い\n\n<二\n>>に');
    expect(truncateToPreviewPages(FIVE_UNIT_PLAIN, 1.9, ITEMS_PER_PAGE)).toBe('一。\n\n二。');
  });

  it('cuts CRLF plain content by paragraph instead of returning the whole book', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_PLAIN.replace(/\n/g, '\r\n'), 1, ITEMS_PER_PAGE)).toBe('一。\n\n二。');
  });

  it.each([
    ['rephrase whose kept item has no sub items', '<一\n\n<二\n>>に', 1],
    ['plain paragraphs that start with an indented >> and <', '<注意\n\n >>矢印', 2],
  ])('sends an empty preview instead of %s read back as another format', (_name, content, maxUnits) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(truncateToPreviewPages(content, 1, maxUnits)).toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps a furigana book whose preview has no furigana, since both render as paragraphs', () => {
    expect(truncateToPreviewPages('一。\n\n二。\n\n漢字[かんじ]。', 1, ITEMS_PER_PAGE)).toBe('一。\n\n二。');
  });

  it('never returns text the parser did not keep, even when the book fits in the preview', () => {
    const content = '>>見出しの前の要約\n\n<一\n>>い\n\n<二\n>>に';

    const preview = truncateToPreviewPages(content, 5, ITEMS_PER_PAGE);

    expect(preview).not.toContain('見出しの前の要約');
    expect(parseReaderItems(preview)).toEqual(parseReaderItems(content));
  });
});
