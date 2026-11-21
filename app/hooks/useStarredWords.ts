'use client';

import { useCallback, useMemo } from 'react';
import { starredWordsPreference, toggleStarredWord } from '@/lib/starredWords';
import { usePreference } from './usePreference';

/** The words starred in one book. Every component using them updates when one is starred anywhere. */
export function useStarredWords(directory: string, bookName: string) {
  const preference = useMemo(() => starredWordsPreference(directory, bookName), [directory, bookName]);
  const [starredWords, saveStarredWords] = usePreference(preference);

  const toggleStar = useCallback(
    (word: string) => saveStarredWords(toggleStarredWord(starredWords, word)),
    [starredWords, saveStarredWords]
  );

  return { starredWords, toggleStar };
}
