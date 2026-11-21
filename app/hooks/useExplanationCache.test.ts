import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPLANATION_MODE, EXPLANATION_CONFIG, EXPLANATION_MODES, STORAGE_KEYS } from '@/lib/constants';
import {
  explanationCacheKey,
  findCachedExplanation,
  keepNewestExplanations,
  readStoredExplanationState,
  storeExplanation,
  useExplanationCache,
} from './useExplanationCache';
import type { CachedExplanation, ExplanationCache } from '@/lib/types';

function storageWith(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key: string) => values[key] ?? null };
}

const SAVED_ENTRY = { sentence: '一文目', explanation: '説明', contextSize: 50, mode: DEFAULT_EXPLANATION_MODE, timestamp: 1 };

describe('readStoredExplanationState', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(readStoredExplanationState(storageWith({}))).toEqual({
      cache: {},
      contextSize: EXPLANATION_CONFIG.DEFAULT_CONTEXT_SIZE,
      mode: DEFAULT_EXPLANATION_MODE,
      contextSizeExpanded: EXPLANATION_CONFIG.CONTEXT_SIZE_EXPANDED_DEFAULT,
    });
  });

  it('reads the saved cache and settings', () => {
    const otherMode = Object.values(EXPLANATION_MODES).find((mode) => mode !== DEFAULT_EXPLANATION_MODE);
    const state = readStoredExplanationState(
      storageWith({
        [STORAGE_KEYS.EXPLANATION_CACHE]: JSON.stringify({ key1: SAVED_ENTRY }),
        [STORAGE_KEYS.EXPLANATION_CONTEXT_SIZE]: '120',
        [STORAGE_KEYS.EXPLANATION_MODE]: otherMode as string,
        [STORAGE_KEYS.CONTEXT_SIZE_EXPANDED]: String(!EXPLANATION_CONFIG.CONTEXT_SIZE_EXPANDED_DEFAULT),
      })
    );

    expect(state).toEqual({
      cache: { key1: SAVED_ENTRY },
      contextSize: 120,
      mode: otherMode,
      contextSizeExpanded: !EXPLANATION_CONFIG.CONTEXT_SIZE_EXPANDED_DEFAULT,
    });
  });

  it('falls back to defaults for a corrupt cache, an unknown mode and a non-numeric size', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const state = readStoredExplanationState(
      storageWith({
        [STORAGE_KEYS.EXPLANATION_CACHE]: '{not json',
        [STORAGE_KEYS.EXPLANATION_CONTEXT_SIZE]: 'many',
        [STORAGE_KEYS.EXPLANATION_MODE]: 'unknown-mode',
      })
    );

    expect(state.cache).toEqual({});
    expect(state.contextSize).toBe(EXPLANATION_CONFIG.DEFAULT_CONTEXT_SIZE);
    expect(state.mode).toBe(DEFAULT_EXPLANATION_MODE);
    error.mockRestore();
  });

  it('reads a saved cache that is not an object as empty', () => {
    expect(readStoredExplanationState(storageWith({ [STORAGE_KEYS.EXPLANATION_CACHE]: 'null' })).cache).toEqual({});
    expect(readStoredExplanationState(storageWith({ [STORAGE_KEYS.EXPLANATION_CACHE]: '[]' })).cache).toEqual({});
  });

  it('keeps legacy entries saved before modes existed and drops malformed ones', () => {
    const legacyEntry = { sentence: '一文目', explanation: '説明', contextSize: 50, timestamp: 1 };
    const state = readStoredExplanationState(
      storageWith({
        [STORAGE_KEYS.EXPLANATION_CACHE]: JSON.stringify({ explanation_book_123: legacyEntry, broken: { sentence: '文' }, empty: null }),
      })
    );

    expect(state.cache).toEqual({ explanation_book_123: legacyEntry });
  });

  it('keeps only the newest entries of an oversized saved cache', () => {
    const saved = Object.fromEntries(
      Array.from({ length: EXPLANATION_CONFIG.MAX_CACHED_EXPLANATIONS + 2 }, (_, index) => [`key${index}`, { ...SAVED_ENTRY, timestamp: index }])
    );

    const { cache } = readStoredExplanationState(storageWith({ [STORAGE_KEYS.EXPLANATION_CACHE]: JSON.stringify(saved) }));

    expect(Object.keys(cache)).toHaveLength(EXPLANATION_CONFIG.MAX_CACHED_EXPLANATIONS);
    expect(cache.key0).toBeUndefined();
    expect(cache.key1).toBeUndefined();
    expect(cache.key2).toBeDefined();
  });
});

const QUERY = { fileName: 'book', sentence: '一文目', mode: DEFAULT_EXPLANATION_MODE, contextSize: 50 };

function cacheHolding(entry: CachedExplanation): ExplanationCache {
  return { [explanationCacheKey(QUERY)]: entry };
}

describe('explanationCacheKey', () => {
  // Existing caches stay readable only while the key format is unchanged.
  it('keeps the book, mode and sentence hash format', () => {
    expect(explanationCacheKey({ fileName: 'dir/book', sentence: 'ab', mode: DEFAULT_EXPLANATION_MODE })).toBe(
      `explanation_dir/book_${DEFAULT_EXPLANATION_MODE}_3105`
    );
  });
});

describe('findCachedExplanation', () => {
  it('returns the entry for the same sentence and context size', () => {
    expect(findCachedExplanation(cacheHolding(SAVED_ENTRY), QUERY)).toEqual(SAVED_ENTRY);
  });

  it('misses an entry made for another context size', () => {
    expect(findCachedExplanation(cacheHolding({ ...SAVED_ENTRY, contextSize: 80 }), QUERY)).toBeNull();
  });

  it('misses an entry whose stored sentence differs, as after a hash collision', () => {
    expect(findCachedExplanation(cacheHolding({ ...SAVED_ENTRY, sentence: '別の文' }), QUERY)).toBeNull();
  });

  it('misses another mode and another book', () => {
    const otherMode = Object.values(EXPLANATION_MODES).find((mode) => mode !== DEFAULT_EXPLANATION_MODE)!;
    const cache = cacheHolding(SAVED_ENTRY);

    expect(findCachedExplanation(cache, { ...QUERY, mode: otherMode })).toBeNull();
    expect(findCachedExplanation(cache, { ...QUERY, fileName: 'other' })).toBeNull();
  });

  it('finds an entry saved without a mode under the current key', () => {
    const entryWithoutMode = { sentence: '一文目', explanation: '説明', contextSize: 50, timestamp: 1 };

    expect(findCachedExplanation(cacheHolding(entryWithoutMode), QUERY)).toEqual(entryWithoutMode);
  });
});

describe('storeExplanation', () => {
  const answer = { ...QUERY, explanation: '新しい説明', requestedAt: 10 };

  it('stores the answer under the sentence key with its request time', () => {
    expect(storeExplanation({}, answer)).toEqual(
      cacheHolding({ sentence: '一文目', explanation: '新しい説明', contextSize: 50, mode: DEFAULT_EXPLANATION_MODE, timestamp: 10 })
    );
  });

  it('overwrites the entry for another context size instead of adding one', () => {
    const cache = storeExplanation(cacheHolding(SAVED_ENTRY), { ...answer, contextSize: 80 });

    expect(Object.keys(cache)).toHaveLength(1);
    expect(findCachedExplanation(cache, { ...QUERY, contextSize: 80 })?.explanation).toBe('新しい説明');
  });

  it('keeps a stored answer requested after the one arriving late', () => {
    const newer = { ...SAVED_ENTRY, contextSize: 80, timestamp: 20 };

    expect(storeExplanation(cacheHolding(newer), answer)).toEqual(cacheHolding(newer));
  });

  it('replaces an entry for a colliding sentence however new it is', () => {
    const colliding = { ...SAVED_ENTRY, sentence: '別の文', timestamp: 99 };

    expect(findCachedExplanation(storeExplanation(cacheHolding(colliding), answer), QUERY)?.explanation).toBe('新しい説明');
  });

  it('drops the oldest entry once the cache is full', () => {
    const full = Object.fromEntries(
      Array.from({ length: EXPLANATION_CONFIG.MAX_CACHED_EXPLANATIONS }, (_, index) => [`key${index}`, { ...SAVED_ENTRY, timestamp: index }])
    );

    const cache = storeExplanation(full, { ...answer, requestedAt: 1000 });

    expect(Object.keys(cache)).toHaveLength(EXPLANATION_CONFIG.MAX_CACHED_EXPLANATIONS);
    expect(cache.key0).toBeUndefined();
    expect(findCachedExplanation(cache, QUERY)?.explanation).toBe('新しい説明');
  });
});

describe('keepNewestExplanations', () => {
  const at = (timestamp: number) => ({ ...SAVED_ENTRY, timestamp });

  it('keeps the newest entries by timestamp, whatever order they were saved in', () => {
    const cache = { b: at(2), d: at(4), a: at(1), c: at(3) };

    expect(keepNewestExplanations(cache, 2)).toEqual({ d: at(4), c: at(3) });
  });

  it('returns a cache within the limit unchanged', () => {
    const cache = { a: at(1), b: at(2) };

    expect(keepNewestExplanations(cache, 2)).toBe(cache);
  });
});

describe('useExplanationCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function CacheSizeProbe() {
    return createElement('span', null, useExplanationCache().getCacheSize());
  }

  // A sidebar that mounts already open decides whether to ask the AI on its
  // first render, so the saved cache must be there before any effect runs.
  it('has the saved cache on its first render', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storageWith({ [STORAGE_KEYS.EXPLANATION_CACHE]: JSON.stringify({ key1: SAVED_ENTRY, key2: SAVED_ENTRY }) }));

    expect(renderToString(createElement(CacheSizeProbe))).toBe('<span>2</span>');
  });
});
