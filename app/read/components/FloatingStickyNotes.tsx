'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { STORAGE_KEYS, THEME } from '@/lib/constants';
import type { Point, Size } from '@/lib/utils/draggablePosition';
import { useDraggablePosition } from '@/app/hooks/useDraggablePosition';
import { toTint } from '@/lib/utils/colorTint';
import { useRubyRegistry } from '@/app/hooks/useRubyRegistry';

interface FloatingStickyNotesProps {
  directory: string;
  bookName: string;
}

function getStarredStorageKey(directory: string, bookName: string): string {
  return `${STORAGE_KEYS.STARRED_WORDS}_${directory}_${bookName}`;
}

const COLLAPSED_SIZE = 44;
const PANEL_WIDTH = 280;
const MAX_HEIGHT = 400;

const COLLAPSED_BOX: Size = { width: COLLAPSED_SIZE, height: COLLAPSED_SIZE };
// Only the header row of the open panel has to stay on screen, so it may run past the bottom edge.
const EXPANDED_BOX: Size = { width: PANEL_WIDTH, height: COLLAPSED_SIZE };

function defaultStickyPosition(): Point {
  return { x: 20, y: 200 };
}

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.STICKY_NOTES_COLLAPSED);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export default function FloatingStickyNotes({
  directory,
  bookName,
}: FloatingStickyNotesProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [starredWords, setStarredWords] = useState<Set<string>>(new Set());
  const { position, isDragging, dragHandlers, isClickFromDrag } = useDraggablePosition({
    storageKey: STORAGE_KEYS.STICKY_NOTES_POSITION,
    size: isCollapsed ? COLLAPSED_BOX : EXPANDED_BOX,
    defaultPosition: defaultStickyPosition,
  });

  // The registry only supplies readings for starred words, so skip it until one exists.
  const { registry } = useRubyRegistry({
    directory,
    bookName,
    enabled: !!directory && !!bookName && starredWords.size > 0,
  });

  useEffect(() => {
    setIsCollapsed(getInitialCollapsed());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      try {
        localStorage.setItem(STORAGE_KEYS.STICKY_NOTES_COLLAPSED, String(isCollapsed));
      } catch {}
    }
  }, [isCollapsed, mounted]);

  const loadStarredWords = useCallback(() => {
    if (!directory || !bookName) return;
    const key = getStarredStorageKey(directory, bookName);
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setStarredWords(new Set(JSON.parse(stored)));
      } catch {
        setStarredWords(new Set());
      }
    } else {
      setStarredWords(new Set());
    }
  }, [directory, bookName]);

  useEffect(() => {
    loadStarredWords();
  }, [loadStarredWords]);

  useEffect(() => {
    const handleStarredChange = () => {
      loadStarredWords();
    };
    window.addEventListener('starredWordsChanged', handleStarredChange);
    return () => window.removeEventListener('starredWordsChanged', handleStarredChange);
  }, [loadStarredWords]);

  const starredEntries = useMemo(() => {
    if (starredWords.size === 0) return [];
    if (!registry) {
      return Array.from(starredWords).map(kanji => ({ kanji, reading: '', note: '' }));
    }
    const matched = registry.entries.filter(e => starredWords.has(e.kanji));
    if (matched.length > 0) return matched;
    return Array.from(starredWords).map(kanji => ({ kanji, reading: '', note: '' }));
  }, [registry, starredWords]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClickFromDrag()) return;
    setIsCollapsed(prev => !prev);
  }, [isClickFromDrag]);

  if (!mounted || !position) return null;
  if (starredWords.size === 0) return null;

  return (
    <div
      className="font-gothic"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 9998,
        touchAction: 'none',
      }}
    >
      {isCollapsed ? (
        <button
          {...dragHandlers}
          onClick={handleToggle}
          className="relative select-none"
          style={{
            width: `${COLLAPSED_SIZE}px`,
            height: `${COLLAPSED_SIZE}px`,
            backgroundColor: THEME.PRIMARY,
            color: THEME.ON_PRIMARY,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
        >
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          {starredEntries.length > 0 && (
            <span
              className="absolute -top-1 -right-1 text-xs font-bold flex items-center justify-center"
              style={{
                width: 20,
                height: 20,
                backgroundColor: THEME.INK,
                color: THEME.ON_INK,
              }}
            >
              {starredEntries.length}
            </span>
          )}
        </button>
      ) : (
        <div
          className="overflow-hidden"
          style={{
            width: `${PANEL_WIDTH}px`,
            maxHeight: `${MAX_HEIGHT}px`,
            backgroundColor: THEME.SURFACE,
            border: `1px solid ${THEME.INK}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            {...dragHandlers}
            className="flex items-center justify-between px-4 py-3 select-none"
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              borderBottom: `1px solid ${THEME.NEUTRAL}`,
              backgroundColor: THEME.BASE,
            }}
          >
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                style={{ fill: THEME.PRIMARY }}
              >
                <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              <span className="font-mincho font-bold text-sm" style={{ color: THEME.INK }}>
                Starred ({starredEntries.length})
              </span>
            </div>
            <button
              onClick={handleToggle}
              className="p-1 cursor-pointer interactive-link"
              style={{ color: THEME.SECONDARY }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div
            className="overflow-y-auto p-3 space-y-2"
            style={{ maxHeight: MAX_HEIGHT - 52 }}
          >
            {starredEntries.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: THEME.SECONDARY }}>
                No starred words
              </p>
            ) : (
              starredEntries.map(entry => (
                <div
                  key={entry.kanji}
                  className="p-2 border"
                  style={{
                    backgroundColor: toTint(THEME.PRIMARY, 6),
                    borderColor: THEME.NEUTRAL,
                    color: THEME.INK,
                  }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mincho text-lg font-bold">
                      {entry.kanji}
                    </span>
                    <span className="text-base" style={{ color: THEME.SECONDARY_DARK }}>
                      {entry.reading}
                    </span>
                  </div>
                  {entry.note && (
                    <p className="text-xs mt-1" style={{ color: THEME.SECONDARY }}>{entry.note}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
