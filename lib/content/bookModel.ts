/**
 * The one place that knows how stored book text becomes reader units, pages
 * and bookmark positions. The reader, the library, the guest preview and the
 * narration builder all go through here so they always agree on unit numbers.
 */

import { parseMarkdown } from '@/lib/utils/markdownParser';
import { stripFurigana } from '@/lib/utils/furiganaParser';
import { PAGINATION_CONFIG, READER_CONFIG } from '@/lib/constants';
import type { ParsedItem, PlayableUnit } from '@/lib/types';

export type ContentType = 'rephrase' | 'furigana' | 'plain';
export type ReaderItem = ParsedItem | { text: string };

const BRACKET_FURIGANA_PATTERN = /[^\[\]]+\[[^\[\]]+\]/;
const LEGACY_PAGE_BOOKMARK_PATTERN = /^page:(\d+)$/;

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

// Both rephrase markers start a line: a ">>" sub item and a "<" or "＜" heading.
// The "<" of a ruby tag (<ruby>, <rb>, <rt>, <rp> or a closing one) is not a
// heading, so furigana prose that happens to contain ">>" is never read as
// rephrase (and rendered empty).
const REPHRASE_SUB_ITEM_LINE = /^>>/m;
const REPHRASE_HEADING_LINE = /^[<＜](?!\/?(?:ruby|rb|rt|rp)>)/m;

export function detectContentType(text: string): ContentType {
  if (REPHRASE_SUB_ITEM_LINE.test(text) && REPHRASE_HEADING_LINE.test(text)) {
    return 'rephrase';
  }
  // The bracket pattern backtracks over long runs, so only try it when a bracket exists.
  if (text.includes('<ruby>') || (text.includes('[') && BRACKET_FURIGANA_PATTERN.test(text))) {
    return 'furigana';
  }
  return 'plain';
}

export function parseReaderItems(content: string): ReaderItem[] {
  const text = normalizeNewlines(content);
  if (detectContentType(text) === 'rephrase') {
    return parseMarkdown(text);
  }
  return text
    .split(READER_CONFIG.PARAGRAPH_SPLIT_PATTERN)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({ text: paragraph }));
}

export function itemMainText(item: ReaderItem): string {
  return 'head' in item ? item.head : item.text;
}

function itemSubText(item: ReaderItem): string | null {
  if (!('head' in item)) return null;
  return item.subItems.length > 0 ? item.subItems[0] : null;
}

export function toPlayableUnits(items: readonly ReaderItem[]): PlayableUnit[] {
  return items.map((item, index) => ({
    globalIndex: index,
    main: itemMainText(item),
    sub: itemSubText(item),
  }));
}

export function buildPlayableUnits(content: string): PlayableUnit[] {
  return toPlayableUnits(parseReaderItems(content));
}

function bookmarkMatchText(text: string): string {
  return stripFurigana(text).replace(/[\r\n]/g, '').trim();
}

/**
 * Bookmarks are stored as the unit's text and the page it was saved on, and
 * matched ignoring furigana and line breaks. The same text can appear more than
 * once: a match on the saved page wins, and when a rebuild moved the text off
 * that page, the copy nearest to it does (ties go to the earlier copy). Without
 * a saved page the first match wins.
 */
export function findBookmarkIndex(
  mainTexts: readonly string[],
  bookmarkText: string,
  savedPage?: number | null
): number | null {
  const target = bookmarkMatchText(bookmarkText);
  if (!target) return null;
  const isMatch = (text: string) => bookmarkMatchText(text) === target;
  if (!savedPage) {
    const firstMatch = mainTexts.findIndex(isMatch);
    return firstMatch === -1 ? null : firstMatch;
  }

  const pageStart = pageStartIndex(savedPage);
  const pageEnd = pageStartIndex(savedPage + 1);
  const matchOnSavedPage = mainTexts.slice(pageStart, pageEnd).findIndex(isMatch);
  if (matchOnSavedPage !== -1) return pageStart + matchOnSavedPage;

  const distanceToSavedPage = (unitIndex: number) => (unitIndex < pageStart ? pageStart - unitIndex : unitIndex - pageEnd + 1);
  return mainTexts.reduce<number | null>((nearest, text, unitIndex) => {
    if (!isMatch(text)) return nearest;
    return nearest === null || distanceToSavedPage(unitIndex) < distanceToSavedPage(nearest) ? unitIndex : nearest;
  }, null);
}

export interface BookmarkLocation {
  unitIndex: number | null;
  page: number | null;
}

/** Where a bookmark sits and which page it opens on, shared by the reader and the library. */
export function locateBookmark(
  mainTexts: readonly string[],
  bookmarkText: string,
  savedPage?: number | null
): BookmarkLocation {
  const legacyPage = legacyPageBookmark(bookmarkText);
  if (legacyPage !== null) return { unitIndex: null, page: legacyPage };
  const unitIndex = findBookmarkIndex(mainTexts, bookmarkText, savedPage);
  return { unitIndex, page: unitIndex === null ? null : pageOfIndex(unitIndex) };
}

/** Bookmarks saved before text bookmarks existed were stored as "page:N". */
export function legacyPageBookmark(bookmarkText: string): number | null {
  const match = bookmarkText.match(LEGACY_PAGE_BOOKMARK_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

export function pageOfIndex(unitIndex: number): number {
  return Math.floor(unitIndex / PAGINATION_CONFIG.ITEMS_PER_PAGE) + 1;
}

export function pageStartIndex(page: number): number {
  return (page - 1) * PAGINATION_CONFIG.ITEMS_PER_PAGE;
}

export function totalPagesFor(unitCount: number): number {
  return Math.ceil(unitCount / PAGINATION_CONFIG.ITEMS_PER_PAGE);
}
