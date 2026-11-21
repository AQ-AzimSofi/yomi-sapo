'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { wordDraftFor, type WordDraft } from '@/lib/content/wordSelection';

// Long enough for a drag or a touch selection handle to come to rest before the action shows.
const SETTLE_MS = 200;
const ITEM_SELECTOR = '.reader-item';
// An item's own text; its simpler versions, buttons and translation sit outside the stored unit text.
const ITEM_TEXT_SELECTOR = '.head-text';

export interface SelectionBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A word selected in a reading item and where the selection sits on the page. */
export interface WordSelection {
  draft: WordDraft;
  /** In document coordinates, so it stays put while the page scrolls. */
  box: SelectionBox;
}

// What the reader shows of a range: its text without the furigana above it.
function shownText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('rt, rp').forEach((annotation) => annotation.remove());
  return fragment.textContent ?? '';
}

function itemTextAround(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element ? element.closest<HTMLElement>(ITEM_TEXT_SELECTOR) : null;
}

function documentBox(range: Range): SelectionBox {
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    bottom: rect.bottom + window.scrollY,
    left: rect.left + window.scrollX,
    right: rect.right + window.scrollX,
  };
}

function isSameWordSelection(previous: WordSelection | null, next: WordSelection | null): boolean {
  if (!previous || !next) return previous === next;
  const { draft, box } = previous;
  return (
    draft.word === next.draft.word &&
    draft.sentence === next.draft.sentence &&
    box.top === next.box.top &&
    box.left === next.box.left &&
    box.bottom === next.box.bottom &&
    box.right === next.box.right
  );
}

function readWordSelection(unitTexts: readonly string[]): WordSelection | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const itemText = itemTextAround(range.startContainer);
  if (!itemText || itemTextAround(range.endContainer) !== itemText) return null;
  // A triple click selects the whole item to copy it, not a word to save.
  if (range.startContainer === itemText && range.endContainer === itemText) return null;

  const unitText = unitTexts[Number(itemText.closest<HTMLElement>(ITEM_SELECTOR)?.dataset.globalIndex)];
  if (unitText === undefined) return null;

  const rangeBefore = document.createRange();
  rangeBefore.setStart(itemText, 0);
  rangeBefore.setEnd(range.startContainer, range.startOffset);
  const draft = wordDraftFor(unitText, { selectedText: shownText(range), textBefore: shownText(rangeBefore) });
  return draft ? { draft, box: documentBox(range) } : null;
}

/**
 * The word the reader has selected inside one reading item, read once the
 * selection settles: after the pointer is released, or a moment after the last
 * change for keyboard and touch-handle selections. Null while nothing savable is
 * selected; the object changes only when the selection does.
 */
export function useWordSelection(unitTexts: readonly string[]) {
  const [wordSelection, setWordSelection] = useState<WordSelection | null>(null);
  const settleTimerRef = useRef<number | undefined>(undefined);
  const isPointerDownRef = useRef(false);

  useEffect(() => {
    const readWhenSettled = () => {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        if (isPointerDownRef.current) return;
        const next = readWordSelection(unitTexts);
        // The same selection read again keeps its object, so callers can tell a new selection by identity.
        setWordSelection((previous) => (isSameWordSelection(previous, next) ? previous : next));
      }, SETTLE_MS);
    };
    const pressPointer = () => {
      isPointerDownRef.current = true;
    };
    const releasePointer = () => {
      isPointerDownRef.current = false;
      readWhenSettled();
    };

    document.addEventListener('selectionchange', readWhenSettled);
    document.addEventListener('pointerdown', pressPointer);
    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);
    return () => {
      window.clearTimeout(settleTimerRef.current);
      document.removeEventListener('selectionchange', readWhenSettled);
      document.removeEventListener('pointerdown', pressPointer);
      document.removeEventListener('pointerup', releasePointer);
      document.removeEventListener('pointercancel', releasePointer);
    };
  }, [unitTexts]);

  const dismiss = useCallback(() => setWordSelection(null), []);

  return { wordSelection, dismiss };
}
