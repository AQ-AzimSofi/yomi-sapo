'use client';

import { useCallback, useState, type FormEvent, type MouseEvent } from 'react';
import { saveBookmark, translate } from '@/lib/api/client';
import type { BookRef } from '@/lib/books/bookRef';

interface ItemActionsInput {
  text: string;
  book: BookRef;
  currentPage?: number;
  onBookmarkSaved: () => void;
}

function selectOnTripleClick(e: MouseEvent<HTMLDivElement>) {
  if (e.detail < 3) return;
  e.stopPropagation();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(e.currentTarget);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** What a reading item's own buttons and text do: bookmark it, translate it, select it on a triple click. */
export function useItemActions({ text, book, currentPage, onBookmarkSaved }: ItemActionsInput) {
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);
  const [isTranslationShown, setIsTranslationShown] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const bookmarkItem = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      try {
        setIsSavingBookmark(true);
        await saveBookmark({ ...book, content: text, page: currentPage });
        onBookmarkSaved();
      } catch (error) {
        console.error(error);
      } finally {
        setIsSavingBookmark(false);
      }
    },
    [book, text, currentPage, onBookmarkSaved]
  );

  const toggleTranslation = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      if (isTranslationShown) {
        setIsTranslationShown(false);
        return;
      }
      if (translatedText) {
        setIsTranslationShown(true);
        return;
      }
      try {
        setIsTranslating(true);
        const response = await translate(text);
        setTranslatedText(response.translatedText);
        setIsTranslationShown(true);
      } catch (error) {
        console.error('Translation error:', error);
      } finally {
        setIsTranslating(false);
      }
    },
    [isTranslationShown, translatedText, text]
  );

  return {
    isSavingBookmark,
    bookmarkItem,
    isTranslationShown,
    translatedText,
    isTranslating,
    toggleTranslation,
    selectOnTripleClick,
  };
}
