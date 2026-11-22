import { savedWordStart, type SavedWordQuery } from '@/lib/vocabulary/sourceLink';

// Styled by ::highlight(saved-word) in app/globals.css.
const SAVED_WORD_HIGHLIGHT = 'saved-word';

// The text a reader sees: everything but the furigana above it.
function shownTextNodes(node: Node): Text[] {
  if (node instanceof Text) return [node];
  if (node instanceof Element && node.matches('rt, rp')) return [];
  return Array.from(node.childNodes).flatMap(shownTextNodes);
}

function shownTextRange(nodes: readonly Text[], start: number, end: number): Range {
  const nodeStarts = nodes.map((_, index) => nodes.slice(0, index).reduce((length, node) => length + node.data.length, 0));
  const startIndex = nodes.findIndex((node, index) => start < nodeStarts[index] + node.data.length);
  const endIndex = nodes.findIndex((node, index) => end <= nodeStarts[index] + node.data.length);
  const range = document.createRange();
  range.setStart(nodes[startIndex], start - nodeStarts[startIndex]);
  range.setEnd(nodes[endIndex], end - nodeStarts[endIndex]);
  return range;
}

/**
 * Marks the saved word in its unit through the CSS highlight registry, which
 * leaves the item's DOM to React. Returns the unmarking; does nothing when the
 * unit is not on the page, the word is not shown, or the browser has no highlights.
 */
export function markSavedWord(unitIndex: number, savedWord: SavedWordQuery): () => void {
  const itemText = document.querySelector(`[data-global-index="${unitIndex}"] .head-text`);
  if (!itemText || typeof CSS === 'undefined' || !('highlights' in CSS)) return () => {};

  const nodes = shownTextNodes(itemText);
  const start = savedWordStart(nodes.map((node) => node.data).join(''), savedWord);
  if (start === -1) return () => {};

  CSS.highlights.set(SAVED_WORD_HIGHLIGHT, new Highlight(shownTextRange(nodes, start, start + savedWord.word.length)));
  return () => CSS.highlights.delete(SAVED_WORD_HIGHLIGHT);
}
