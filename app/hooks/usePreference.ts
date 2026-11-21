'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { preferenceValue, subscribeToPreferences, writePreference, type Preference } from '@/lib/preferences';

/**
 * A stored preference and its setter. Every component reading the same preference
 * re-renders after a write, whether it happened here or in another tab.
 */
export function usePreference<T>(preference: Preference<T>): [T, (value: T) => void] {
  // The stored string is the snapshot because it compares by value, which a parsed object would not.
  const stored = useSyncExternalStore(
    subscribeToPreferences,
    () => localStorage.getItem(preference.key),
    () => null
  );
  const value = useMemo(() => preferenceValue(preference, stored), [preference, stored]);
  const setValue = useCallback((next: T) => writePreference(localStorage, preference, next), [preference]);
  return [value, setValue];
}
