/**
 * 文説明のキャッシュ管理のためのカスタムフック
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { STORAGE_KEYS, EXPLANATION_CONFIG, DEFAULT_EXPLANATION_MODE, EXPLANATION_MODES } from '@/lib/constants';
import { isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import type { ExplanationCache, CachedExplanation } from '@/lib/types';
import type { ExplanationMode } from '@/lib/constants';

interface ExplanationCacheKeyParts {
  fileName: string;
  sentence: string;
  mode: ExplanationMode;
}

export interface ExplanationCacheQuery extends ExplanationCacheKeyParts {
  contextSize: number;
  context: string;
}

export interface ExplanationAnswer extends ExplanationCacheQuery {
  explanation: string;
  requestedAt: number;
}

interface UseExplanationCacheReturn {
  getCache: (query: ExplanationCacheQuery) => CachedExplanation | null;
  setCache: (answer: ExplanationAnswer) => void;
  clearCache: () => void;
  getCacheSize: () => number;
  contextSize: number;
  setContextSize: (size: number) => void;
  mode: ExplanationMode;
  setMode: (mode: ExplanationMode) => void;
  contextSizeExpanded: boolean;
  setContextSizeExpanded: (expanded: boolean) => void;
}

export interface StoredExplanationState {
  cache: ExplanationCache;
  contextSize: number;
  mode: ExplanationMode;
  contextSizeExpanded: boolean;
}

const DEFAULT_STATE: StoredExplanationState = {
  cache: {},
  contextSize: EXPLANATION_CONFIG.DEFAULT_CONTEXT_SIZE,
  mode: DEFAULT_EXPLANATION_MODE,
  contextSizeExpanded: EXPLANATION_CONFIG.CONTEXT_SIZE_EXPANDED_DEFAULT,
};

// The key leaves out the context size, so an answer for another size replaces
// the entry instead of adding one. Changing the format would orphan every saved answer.
export function explanationCacheKey({ fileName, sentence, mode }: ExplanationCacheKeyParts): string {
  const hash = sentence.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return `${EXPLANATION_CONFIG.CACHE_KEY_PREFIX}${fileName}_${mode}_${hash}`;
}

/**
 * A saved answer only counts when it was made for this very sentence, context
 * size and passage, so a line repeated elsewhere in the book gets its own answer.
 * Entries saved before the passage was stored have no passage to compare, so
 * they still count wherever the sentence appears rather than being thrown away.
 */
export function findCachedExplanation(cache: ExplanationCache, query: ExplanationCacheQuery): CachedExplanation | null {
  const entry = cache[explanationCacheKey(query)];
  if (!entry || entry.sentence !== query.sentence) return null;
  if (entry.contextSize !== query.contextSize) return null;
  const isOtherPassage = entry.context !== undefined && entry.context !== query.context;
  return isOtherPassage ? null : entry;
}

export function keepNewestExplanations(cache: ExplanationCache, maxEntries: number): ExplanationCache {
  const entries = Object.entries(cache);
  if (entries.length <= maxEntries) return cache;
  const newestFirst = entries.sort(([, a], [, b]) => b.timestamp - a.timestamp);
  return Object.fromEntries(newestFirst.slice(0, maxEntries));
}

export function storeExplanation(cache: ExplanationCache, answer: ExplanationAnswer): ExplanationCache {
  const key = explanationCacheKey(answer);
  const stored = cache[key];
  const isOutdatedAnswer = stored?.sentence === answer.sentence && stored.timestamp > answer.requestedAt;
  if (isOutdatedAnswer) return cache;
  const { sentence, context, explanation, contextSize, mode, requestedAt } = answer;
  const entry: CachedExplanation = { sentence, context, explanation, contextSize, mode, timestamp: requestedAt };
  return keepNewestExplanations({ ...cache, [key]: entry }, EXPLANATION_CONFIG.MAX_CACHED_EXPLANATIONS);
}

function isCachedExplanation(value: unknown): value is CachedExplanation {
  return (
    isRecord(value) &&
    typeof value.sentence === 'string' &&
    typeof value.explanation === 'string' &&
    typeof value.contextSize === 'number' &&
    typeof value.timestamp === 'number' &&
    isOptionalString(value.context)
  );
}

function parseCache(stored: string | null): ExplanationCache {
  if (!stored) return DEFAULT_STATE.cache;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return DEFAULT_STATE.cache;
    const entries = Object.entries(parsed).filter(
      (pair): pair is [string, CachedExplanation] => isCachedExplanation(pair[1])
    );
    return keepNewestExplanations(Object.fromEntries(entries), EXPLANATION_CONFIG.MAX_CACHED_EXPLANATIONS);
  } catch (error) {
    console.error('キャッシュの読み込み中にエラーが発生しました:', error);
    return DEFAULT_STATE.cache;
  }
}

function parseContextSize(stored: string | null): number {
  const size = stored === null ? NaN : parseInt(stored, 10);
  return isNaN(size) ? DEFAULT_STATE.contextSize : size;
}

function parseMode(stored: string | null): ExplanationMode {
  const isKnownMode = Object.values(EXPLANATION_MODES).includes(stored as ExplanationMode);
  return isKnownMode ? (stored as ExplanationMode) : DEFAULT_STATE.mode;
}

/**
 * Reads the saved cache and settings. The hook reads them while rendering, not
 * in an effect, so a sidebar that mounts already open sees the cache before
 * deciding whether to ask the AI.
 */
export function readStoredExplanationState(storage: Pick<Storage, 'getItem'>): StoredExplanationState {
  const storedExpanded = storage.getItem(STORAGE_KEYS.CONTEXT_SIZE_EXPANDED);
  return {
    cache: parseCache(storage.getItem(STORAGE_KEYS.EXPLANATION_CACHE)),
    contextSize: parseContextSize(storage.getItem(STORAGE_KEYS.EXPLANATION_CONTEXT_SIZE)),
    mode: parseMode(storage.getItem(STORAGE_KEYS.EXPLANATION_MODE)),
    contextSizeExpanded: storedExpanded === null ? DEFAULT_STATE.contextSizeExpanded : storedExpanded === 'true',
  };
}

function saveCache(cache: ExplanationCache): void {
  try {
    localStorage.setItem(STORAGE_KEYS.EXPLANATION_CACHE, JSON.stringify(cache));
  } catch (error) {
    console.error('キャッシュの保存中にエラーが発生しました:', error);
  }
}

function readInitialState(): StoredExplanationState {
  return typeof window === 'undefined' ? DEFAULT_STATE : readStoredExplanationState(localStorage);
}

/**
 * 文説明のキャッシュを管理する
 * localStorageを使用してキャッシュを永続化
 */
export function useExplanationCache(): UseExplanationCacheReturn {
  const [initialState] = useState(readInitialState);
  // Nothing renders the cache itself, so it lives in a ref: storing an answer never
  // re-runs the effect that looks answers up, and a late AI response always updates
  // the latest copy rather than an older one.
  const cacheRef = useRef<ExplanationCache>(initialState.cache);
  const [contextSize, setContextSizeState] = useState<number>(initialState.contextSize);
  const [mode, setModeState] = useState<ExplanationMode>(initialState.mode);
  const [contextSizeExpanded, setContextSizeExpandedState] = useState<boolean>(initialState.contextSizeExpanded);

  const getCache = useCallback((query: ExplanationCacheQuery) => findCachedExplanation(cacheRef.current, query), []);

  const setCache = useCallback((answer: ExplanationAnswer) => {
    const nextCache = storeExplanation(cacheRef.current, answer);
    if (nextCache === cacheRef.current) return;
    cacheRef.current = nextCache;
    saveCache(nextCache);
  }, []);

  // キャッシュをクリア
  const clearCache = useCallback(() => {
    cacheRef.current = {};
    saveCache({});
  }, []);

  // キャッシュサイズを取得
  const getCacheSize = useCallback((): number => {
    return Object.keys(cacheRef.current).length;
  }, []);

  // コンテキストサイズを設定
  const setContextSize = useCallback((size: number) => {
    const clampedSize = Math.max(
      EXPLANATION_CONFIG.MIN_CONTEXT_SIZE,
      Math.min(EXPLANATION_CONFIG.MAX_CONTEXT_SIZE, size)
    );
    setContextSizeState(clampedSize);

    if (typeof window !== 'undefined') {
      localStorage.setItem(
        STORAGE_KEYS.EXPLANATION_CONTEXT_SIZE,
        clampedSize.toString()
      );
    }
  }, []);

  // 説明モードを設定
  const setMode = useCallback((newMode: ExplanationMode) => {
    setModeState(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.EXPLANATION_MODE, newMode);
    }
  }, []);

  // コンテキストサイズの展開状態を設定
  const setContextSizeExpanded = useCallback((expanded: boolean) => {
    setContextSizeExpandedState(expanded);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.CONTEXT_SIZE_EXPANDED, expanded.toString());
    }
  }, []);

  return {
    getCache,
    setCache,
    clearCache,
    getCacheSize,
    contextSize,
    setContextSize,
    mode,
    setMode,
    contextSizeExpanded,
    setContextSizeExpanded,
  };
}
