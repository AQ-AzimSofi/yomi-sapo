'use client';

import { useEffect, useState, useCallback } from 'react';
import { ApiError, fetchRubyRegistry, removeRubyRegistryItem, saveRubyEntry } from '@/lib/api/client';
import type { RubyRegistry, RubyEntry } from '@/lib/types';
import type { RubyRegistryResponse } from '@/lib/api/contracts';

interface UseRubyRegistryOptions {
  directory: string;
  bookName: string;
  enabled?: boolean;
}

interface UseRubyRegistryReturn {
  registry: RubyRegistry | null;
  isLoading: boolean;
  error: Error | null;
  addEntry: (entry: Omit<RubyEntry, 'source'> & { source?: 'epub' | 'user' }) => Promise<void>;
  deleteEntry: (kanji: string) => Promise<void>;
  ignoreSuggestion: (kanji: string) => Promise<void>;
  refetch: () => Promise<void>;
  searchEntries: (query: string) => RubyEntry[];
}

// Names the failed action and the HTTP status text, e.g. "Failed to save entry: Not Found".
function toRegistryError(error: unknown, failedAction: string): Error {
  if (error instanceof ApiError) return new Error(`${failedAction}: ${error.statusText}`);
  if (error instanceof Error) return error;
  return new Error('Unknown error');
}

export function useRubyRegistry({
  directory,
  bookName,
  enabled = true,
}: UseRubyRegistryOptions): UseRubyRegistryReturn {
  const [registry, setRegistry] = useState<RubyRegistry | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchRegistry = useCallback(async () => {
    if (!directory || !bookName) {
      setRegistry(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchRubyRegistry({ directory, bookName });
      if (data.success && data.registry) {
        setRegistry(data.registry);
      }
    } catch (err) {
      const error = toRegistryError(err, 'Failed to load registry');
      setError(error);
      console.error('Error fetching ruby registry:', error);
    } finally {
      setIsLoading(false);
    }
  }, [directory, bookName]);

  const changeRegistry = async (failedAction: string, change: () => Promise<RubyRegistryResponse>) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await change();
      if (data.success && data.registry) {
        setRegistry(data.registry);
      }
    } catch (err) {
      const error = toRegistryError(err, failedAction);
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const addEntry = (entry: Omit<RubyEntry, 'source'> & { source?: 'epub' | 'user' }) =>
    changeRegistry('Failed to save entry', () =>
      saveRubyEntry({
        directory,
        bookName,
        entry: {
          ...entry,
          source: entry.source || 'user',
          note: entry.note || ''
        }
      })
    );

  const deleteEntry = (kanji: string) =>
    changeRegistry('Failed to delete entry', () => removeRubyRegistryItem({ directory, bookName }, kanji, 'entry'));

  const ignoreSuggestion = (kanji: string) =>
    changeRegistry('Failed to ignore suggestion', () =>
      removeRubyRegistryItem({ directory, bookName }, kanji, 'suggestion')
    );

  const searchEntries = useCallback((query: string): RubyEntry[] => {
    if (!registry || !query.trim()) {
      return registry?.entries || [];
    }
    const q = query.toLowerCase();
    return registry.entries.filter(e =>
      e.kanji.includes(q) ||
      e.reading.includes(q) ||
      e.note.toLowerCase().includes(q)
    );
  }, [registry]);

  useEffect(() => {
    if (enabled) {
      fetchRegistry();
    }
  }, [enabled, fetchRegistry]);

  return {
    registry,
    isLoading,
    error,
    addEntry,
    deleteEntry,
    ignoreSuggestion,
    refetch: fetchRegistry,
    searchEntries,
  };
}
