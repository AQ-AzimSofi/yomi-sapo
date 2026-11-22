'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { STORAGE_KEYS, TTS_CONFIG, type TTSVoiceGender } from '@/lib/constants';
import { createReadAloudPlayer, READ_ALOUD_IDLE, type ReadAloudAudio } from '@/lib/audio/readAloudPlayer';
import { fetchTTS } from '@/lib/utils/ttsCache';

function readStoredSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storedVoiceGender(): TTSVoiceGender {
  const gender = readStoredSetting(STORAGE_KEYS.TTS_VOICE_GENDER);
  return gender === 'MALE' || gender === 'FEMALE' ? gender : TTS_CONFIG.DEFAULT_VOICE_GENDER;
}

// Normal speed, as the audiobook asks for its clips, so both share fetchTTS's cache and a
// speed change needs no new clip.
function synthesizeClip(text: string): Promise<string | null> {
  return fetchTTS({ text, speed: 1, voiceGender: storedVoiceGender() });
}

function createClipAudio(clip: string): ReadAloudAudio {
  return new Audio(`data:audio/mp3;base64,${clip}`);
}

/**
 * The reader's one read-aloud player, shared by every item's speaker button. It plays
 * at the audiobook's speed, so the player bar's speed setting covers both.
 */
export function useReadAloud(speed: number) {
  const [player] = useState(() => createReadAloudPlayer({ synthesize: synthesizeClip, createAudio: createClipAudio }));
  const state = useSyncExternalStore(player.subscribe, player.getState, () => READ_ALOUD_IDLE);

  useEffect(() => player.stop, [player]);

  useEffect(() => {
    player.setSpeed(speed);
  }, [player, speed]);

  return { state, toggle: player.toggle, stop: player.stop };
}
