import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPLANATION_MODE, EXPLANATION_CONFIG, EXPLANATION_MODES, STORAGE_KEYS } from '@/lib/constants';
import { readStoredExplanationState, useExplanationCache } from './useExplanationCache';

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
