import { describe, it, expect } from 'vitest';
import { truncateToPreviewPages } from './truncatePreview';
import { buildPlayableUnits } from '@/lib/content/bookModel';
import { PAGINATION_CONFIG } from '@/lib/constants';

const ITEMS_PER_PAGE = 2;
const FIVE_UNIT_REPHRASE = '<一\n>>い\n\n<二\n>>に\n\n<三\n>>さん\n\n<四\n>>よん\n\n<五\n>>ご';
const FIVE_UNIT_PLAIN = '一。\n\n二。\n\n三。\n\n四。\n\n五。';

describe('truncateToPreviewPages', () => {
  it('returns plain content unchanged when it is shorter than the cap', () => {
    const content = '  一。\n\n\n二。\n';

    expect(truncateToPreviewPages(content, 2, ITEMS_PER_PAGE)).toBe(content);
  });

  it('returns rephrase content unchanged when it is shorter than the cap', () => {
    const content = '<一\n>>い\n\n\n<二\n>>に\n';

    expect(truncateToPreviewPages(content, 2, ITEMS_PER_PAGE)).toBe(content);
  });

  it('returns content unchanged when its unit count equals the cap', () => {
    const content = '一。\n\n二。';

    expect(truncateToPreviewPages(content, 1, ITEMS_PER_PAGE)).toBe(content);
  });

  it('cuts rephrase content to text that parses back to the first N pages of units', () => {
    const preview = truncateToPreviewPages(FIVE_UNIT_REPHRASE, 2, ITEMS_PER_PAGE);
    const firstFourUnits = buildPlayableUnits(FIVE_UNIT_REPHRASE).slice(0, 2 * ITEMS_PER_PAGE);

    expect(buildPlayableUnits(preview)).toEqual(firstFourUnits);
  });

  it('writes cut rephrase content in < head and >> sub form', () => {
    expect(truncateToPreviewPages(FIVE_UNIT_REPHRASE, 1, ITEMS_PER_PAGE)).toBe('<一\n>>い\n\n<二\n>>に');
  });

  it('keeps every sub item of a kept rephrase unit', () => {
    const content = '<一\n>>い\n>>イ\n\n<二\n>>に';

    expect(truncateToPreviewPages(content, 1, 1)).toBe('<一\n>>い\n>>イ');
  });

  it('cuts plain content to text that parses back to the first N pages of units', () => {
    const preview = truncateToPreviewPages(FIVE_UNIT_PLAIN, 2, ITEMS_PER_PAGE);
    const firstFourUnits = buildPlayableUnits(FIVE_UNIT_PLAIN).slice(0, 2 * ITEMS_PER_PAGE);

    expect(buildPlayableUnits(preview)).toEqual(firstFourUnits);
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

  it.todo('cuts CRLF plain content by paragraph instead of returning the whole book (bug)');
});
