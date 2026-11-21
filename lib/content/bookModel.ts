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

export function detectContentType(text: string): ContentType {
  if (text.includes('>>') && /[<＜]/.test(text)) {
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
 * Bookmarks are stored as the unit's text. The first unit whose text matches
 * (ignoring furigana and line breaks) is the bookmarked one.
 */
export function findBookmarkIndex(mainTexts: readonly string[], bookmarkText: string): number | null {
  const target = bookmarkMatchText(bookmarkText);
  if (!target) return null;
  const index = mainTexts.findIndex((text) => bookmarkMatchText(text) === target);
  return index === -1 ? null : index;
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
