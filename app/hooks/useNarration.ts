'use client';

import { useEffect, useState } from 'react';
import { toBookKey, type BookRef } from '@/lib/books/bookRef';
import { ApiError, fetchNarration } from '@/lib/api/client';
import type { NarrationCue, NarrationManifest } from '@/lib/types';

export interface NarrationLoad {
  manifest: NarrationManifest | null;
  error: string | null;
}

const ABSENT: NarrationLoad = { manifest: null, error: null };

function parseCue(value: unknown): NarrationCue | null {
  if (!value || typeof value !== 'object') return null;
  const { start, end } = value as Record<string, unknown>;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!isFinite(start) || !isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  return { start, end };
}

function parseManifest(value: unknown, bookKey: string): NarrationManifest | null {
  if (!value || typeof value !== 'object') {
    console.error(`Narration manifest is not an object: ${bookKey}`);
    return null;
  }
  const { audioUrl, unitCount, cues } = value as Record<string, unknown>;
  if (typeof audioUrl !== 'string' || !audioUrl) {
    console.error(`Narration manifest has no audioUrl: ${bookKey}`);
    return null;
  }
  if (typeof unitCount !== 'number' || !Number.isInteger(unitCount) || unitCount <= 0) {
    console.error(`Narration manifest has no usable unitCount: ${bookKey}`);
    return null;
  }
  if (!Array.isArray(cues)) {
    console.error(`Narration manifest has no cues array: ${bookKey}`);
    return null;
  }
  // cues is what gets indexed by unit, so a short array would quietly drop the
  // tail of the book even though unitCount looked right.
  if (cues.length !== unitCount) {
    console.error(`Narration manifest declares ${unitCount} units but has ${cues.length} cues: ${bookKey}`);
    return null;
  }

  const parsed = cues.map(parseCue);
  const dropped = parsed.filter((cue, index) => !cue && cues[index] !== null).length;
  if (dropped > 0) {
    console.error(`Narration manifest has ${dropped} malformed cues, those units fall back to TTS: ${bookKey}`);
  }
  if (!parsed.some(Boolean)) {
    console.error(`Narration manifest covers no units: ${bookKey}`);
    return null;
  }
  return { audioUrl, unitCount, cues: parsed };
}

/**
 * Loads the narration recording paired with the text variant being read.
 *
 * Cues are positional, so the manifest is only usable when the book still starts
 * with the units it was built from. A shorter book is accepted because it is a
 * prefix -- that is how the guest preview arrives -- but a longer one means the
 * text was re-processed and every cue after the change would play the wrong line.
 */
export function useNarration(book: BookRef | null, unitCount: number): NarrationLoad {
  const [load, setLoad] = useState<NarrationLoad>(ABSENT);

  useEffect(() => {
    // Drop the previous book's manifest before anything else. Cues are positional,
    // so serving book A's cues against book B's units for even one render is the
    // exact mismatch unitCount exists to prevent.
    setLoad(ABSENT);
    if (!book || unitCount <= 0) return;

    const controller = new AbortController();
    const bookKey = toBookKey(book);

    const fail = (message: string, detail: string) => {
      console.error(`${detail}: ${bookKey}`);
      setLoad({ manifest: null, error: message });
    };

    const loadManifest = async () => {
      try {
        const manifest = await fetchNarration(book, controller.signal);
        if (controller.signal.aborted) return;
        if (!manifest) return;

        const parsed = parseManifest(manifest, bookKey);
        if (!parsed) {
          fail('Audiobook recording is unusable', 'Narration manifest failed validation');
          return;
        }
        if (parsed.unitCount < unitCount) {
          fail(
            'Audiobook recording is out of date',
            `Narration manifest is stale: built for ${parsed.unitCount} units, this text now has ${unitCount}. Rebuild it with scripts/audio/build-narration.ts`
          );
          return;
        }
        setLoad({ manifest: parsed, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError) {
          fail('Audiobook recording could not be loaded', `Narration manifest request failed (${error.status})`);
          return;
        }
        console.error(`Failed to load narration manifest: ${bookKey}`, error);
        setLoad({ manifest: null, error: 'Audiobook recording could not be loaded' });
      }
    };

    loadManifest();
    return () => controller.abort();
  }, [book, unitCount]);

  return load;
}
