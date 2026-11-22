'use client';

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { THEME } from '@/lib/constants';
import { saveVocabularyEntry } from '@/lib/api/client';
import { useWordSelection, type SelectionBox, type WordSelection } from '@/app/hooks/useWordSelection';
import type { BookRef } from '@/lib/books/bookRef';

type SaveStatus = 'saving' | 'saved' | 'already-saved' | 'failed';
type SaveOutcome = Exclude<SaveStatus, 'saving'>;

const OUTCOME_MESSAGES: Record<SaveOutcome, string> = {
  saved: '保存しました',
  'already-saved': '保存済みです',
  failed: '保存できませんでした',
};

const OUTCOME_SHOWN_MS: Record<SaveOutcome, number> = {
  saved: 1800,
  'already-saved': 1800,
  failed: 3000,
};

const GAP_PX = 8;
// Leaves room for the handles a touch screen draws under a selection.
const TOUCH_GAP_PX = 28;
const ACTION_HEIGHT_PX = 48;
const SIDE_MARGIN_PX = 16;
const MAX_WIDTH_PX = 320;

interface SaveWordActionProps {
  unitTexts: readonly string[];
  book: BookRef;
  /** False while a panel covers the reader. */
  isEnabled: boolean;
  /** Space a bar fixed to the bottom of the screen takes, which the action must not sit under. */
  bottomInsetPx: number;
}

interface PendingSave {
  selection: WordSelection;
  status: SaveStatus;
}

// Below the selection, clear of the menu phones show above it; above when the bottom of the screen is too close.
function placeNear(box: SelectionBox, bottomInsetPx: number): CSSProperties {
  const belowGap = window.matchMedia('(pointer: coarse)').matches ? TOUCH_GAP_PX : GAP_PX;
  const visibleBottom = window.scrollY + window.innerHeight - bottomInsetPx;
  const fitsBelow = box.bottom + belowGap + ACTION_HEIGHT_PX <= visibleBottom;
  const halfWidth = Math.min(MAX_WIDTH_PX, window.innerWidth - 2 * SIDE_MARGIN_PX) / 2;
  const selectionCenter = (box.left + box.right) / 2;
  const left = Math.min(Math.max(selectionCenter, SIDE_MARGIN_PX + halfWidth), window.innerWidth - SIDE_MARGIN_PX - halfWidth);
  if (fitsBelow) return { top: box.bottom + belowGap, left, transform: 'translateX(-50%)' };
  return { top: box.top - GAP_PX, left, transform: 'translate(-50%, -100%)' };
}

/** The 単語帳に保存 action shown next to a word the owner selects in a reading item. */
function SaveWordAction({ unitTexts, book, isEnabled, bottomInsetPx }: SaveWordActionProps) {
  const { wordSelection, dismiss } = useWordSelection(unitTexts);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A save keeps showing the word it was started for, also when tapping the button cleared the
  // selection, until its outcome has been read or another word is selected.
  const isSavedWordSelected = wordSelection === null || wordSelection === pendingSave?.selection;
  const isSaveShown = pendingSave !== null && (pendingSave.status === 'saving' || isSavedWordSelected);
  const shownSelection = isEnabled ? (isSaveShown ? pendingSave.selection : wordSelection) : null;
  const isShown = shownSelection !== null;

  const close = useCallback(() => {
    setPendingSave(null);
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    if (!pendingSave || pendingSave.status === 'saving') return;
    const timer = setTimeout(() => {
      setPendingSave(null);
      // The saved word's action is done; a word selected since keeps its own.
      if (isSavedWordSelected) dismiss();
    }, OUTCOME_SHOWN_MS[pendingSave.status]);
    return () => clearTimeout(timer);
  }, [pendingSave, isSavedWordSelected, dismiss]);

  useEffect(() => {
    if (!isShown) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Captured before the reader's own Escape, which leaves the audiobook keyboard mode.
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab' || event.shiftKey) return;
      if (groupRef.current?.contains(document.activeElement)) return;
      if (!buttonRef.current) return;
      event.preventDefault();
      buttonRef.current.focus();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isShown, close]);

  if (!shownSelection) return null;

  const save = async () => {
    const selection = shownSelection;
    setPendingSave({ selection, status: 'saving' });
    try {
      const response = await saveVocabularyEntry({ ...selection.draft, ...book });
      setPendingSave({ selection, status: response.created ? 'saved' : 'already-saved' });
    } catch (error) {
      console.error('Failed to save the word:', error);
      setPendingSave({ selection, status: 'failed' });
    }
  };

  const { word, reading } = shownSelection.draft;
  const status = isSaveShown ? pendingSave.status : null;
  const outcome = status && status !== 'saving' ? status : null;
  const outcomeMessage = outcome ? OUTCOME_MESSAGES[outcome] : '';

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="選択した語"
      className="font-gothic flex items-center gap-2 pl-3 pr-1.5 py-1.5"
      // Pressing the button must not clear the selection it saves.
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        zIndex: 45,
        maxWidth: `min(${MAX_WIDTH_PX}px, calc(100vw - ${2 * SIDE_MARGIN_PX}px))`,
        backgroundColor: THEME.SURFACE,
        border: `1px solid ${THEME.INK}`,
        color: THEME.INK,
        ...placeNear(shownSelection.box, bottomInsetPx),
      }}
    >
      {/* The reading gives way first when a long word and a message share the row. */}
      <span className="font-mincho font-bold text-[15px] truncate shrink-0 max-w-[10em]">{word}</span>
      {reading && (
        <span className="text-[11px] truncate min-w-0" style={{ color: THEME.SECONDARY }}>
          {reading}
        </span>
      )}
      {/* Present from the start, so a screen reader announces the outcome when it fills in. */}
      <span role="status" className="sr-only">
        {outcomeMessage}
      </span>
      {outcome ? (
        <span
          aria-hidden="true"
          className="min-h-9 px-1.5 flex items-center text-[12px] font-bold whitespace-nowrap"
          style={{ color: outcome === 'failed' ? THEME.DANGER : THEME.PRIMARY }}
        >
          {outcomeMessage}
        </span>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={save}
          disabled={status === 'saving'}
          className="interactive-btn flex-shrink-0 min-h-9 px-3 text-[12px] font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ backgroundColor: THEME.PRIMARY, color: THEME.ON_PRIMARY, outlineColor: THEME.INK }}
        >
          {status === 'saving' ? '保存中…' : '単語帳に保存'}
        </button>
      )}
    </div>
  );
}

// Every prop is a stable value, so the reader's own updates (an audiobook step) skip it.
export default memo(SaveWordAction);
