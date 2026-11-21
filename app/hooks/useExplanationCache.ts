/**
 * 文説明のキャッシュ管理のためのカスタムフック
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS, EXPLANATION_CONFIG, DEFAULT_EXPLANATION_MODE, EXPLANATION_MODES } from '@/lib/constants';
import type { ExplanationCache, CachedExplanation } from '@/lib/types';
import type { ExplanationMode } from '@/lib/constants';

interface UseExplanationCacheReturn {
  getCache: (fileName: string, sentence: string, mode: ExplanationMode) => CachedExplanation | null;
  setCache: (fileName: string, sentence: string, explanation: string, contextSize: number, mode: ExplanationMode) => void;
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

function parseCache(stored: string | null): ExplanationCache {
  if (!stored) return DEFAULT_STATE.cache;
  try {
    return JSON.parse(stored);
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

function readInitialState(): StoredExplanationState {
  return typeof window === 'undefined' ? DEFAULT_STATE : readStoredExplanationState(localStorage);
}

/**
 * 文説明のキャッシュを管理する
 * localStorageを使用してキャッシュを永続化
 */
export function useExplanationCache(): UseExplanationCacheReturn {
  const [initialState] = useState(readInitialState);
  const [cache, setCacheState] = useState<ExplanationCache>(initialState.cache);
  const [contextSize, setContextSizeState] = useState<number>(initialState.contextSize);
  const [mode, setModeState] = useState<ExplanationMode>(initialState.mode);
  const [contextSizeExpanded, setContextSizeExpandedState] = useState<boolean>(initialState.contextSizeExpanded);

  // Saved after every change. setCache updates from the latest state, so a
  // late AI response can never write back an older copy of the cache.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.EXPLANATION_CACHE, JSON.stringify(cache));
    } catch (error) {
      console.error('キャッシュの保存中にエラーが発生しました:', error);
    }
  }, [cache]);

  // キャッシュキーを生成（モード別にキャッシュを分離）
  const generateCacheKey = useCallback((fileName: string, sentence: string, mode: ExplanationMode): string => {
    // 文をハッシュ化（簡易版）
    const hash = sentence.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    return `${EXPLANATION_CONFIG.CACHE_KEY_PREFIX}${fileName}_${mode}_${hash}`;
  }, []);

  // キャッシュから取得
  const getCache = useCallback(
    (fileName: string, sentence: string, mode: ExplanationMode): CachedExplanation | null => {
      const key = generateCacheKey(fileName, sentence, mode);
      return cache[key] || null;
    },
    [cache, generateCacheKey]
  );

  // キャッシュに保存
  const setCache = useCallback(
    (fileName: string, sentence: string, explanation: string, contextSize: number, mode: ExplanationMode) => {
      const key = generateCacheKey(fileName, sentence, mode);
      const entry: CachedExplanation = { sentence, explanation, contextSize, mode, timestamp: Date.now() };
      setCacheState((previous) => ({ ...previous, [key]: entry }));
    },
    [generateCacheKey]
  );

  // キャッシュをクリア
  const clearCache = useCallback(() => {
    setCacheState({});
  }, []);

  // キャッシュサイズを取得
  const getCacheSize = useCallback((): number => {
    return Object.keys(cache).length;
  }, [cache]);

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
