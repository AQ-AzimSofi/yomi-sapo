import { detectContentType, normalizeNewlines, parseReaderItems, type ReaderItem } from '@/lib/content/bookModel';
import { PAGINATION_CONFIG } from '@/lib/constants';

function serializeItem(item: ReaderItem): string {
  if (!('head' in item)) return item.text;
  return [`<${item.head}`, ...item.subItems.map((sub) => `>>${sub}`)].join('\n');
}

/**
 * Trims book content to the first N reader pages for the guest preview.
 *
 * A "page" is a client-side slice of PAGINATION_CONFIG.ITEMS_PER_PAGE reader
 * units, so the cap is expressed in units. The reader re-derives units from the
 * text with the same book model, so the returned text must parse back to the same
 * unit boundaries: rephrase items are re-serialized in canonical `<head` / `>>sub`
 * form and paragraphs are joined by blank lines.
 * The output is always rebuilt from the parsed items, even when the book is
 * shorter than the cap, so text the parser did not keep never reaches a guest.
 */
export function truncateToPreviewPages(
  content: string,
  maxPages: number,
  itemsPerPage: number = PAGINATION_CONFIG.ITEMS_PER_PAGE
): string {
  // Clamp defensively: a mis-edited (zero/negative/non-integer) cap must never
  // widen the preview via slice(0, negative) or a fractional boundary.
  const maxUnits = Math.max(0, Math.floor(maxPages)) * itemsPerPage;
  const preview = parseReaderItems(content).slice(0, maxUnits).map(serializeItem).join('\n\n');
  // The guest reader detects the format again. A preview that reads as another
  // format would show different units, so send nothing rather than wrong text.
  if (preview && detectContentType(preview) !== detectContentType(normalizeNewlines(content))) {
    console.warn('Guest preview changed content type; sending an empty preview');
    return '';
  }
  return preview;
}
