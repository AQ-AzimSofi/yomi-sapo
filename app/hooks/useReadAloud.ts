'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { STORAGE_KEYS, TTS_CONFIG, type TTSVoiceGender } from '@/lib/constants';
import { createReadAloudPlayer, READ_ALOUD_IDLE, type ReadAloudAudio } from '@/lib/audio/readAloudPlayer';
import { synthesizeSpeech } from '@/lib/api/client';
import { cleanTextForTTS } from '@/lib/utils/ttsTextCleaner';

function readStoredSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storedSpeed(): number {
  const speed = parseFloat(readStoredSetting(STORAGE_KEYS.TTS_SPEED) ?? '');
  const isValid = !isNaN(speed) && speed >= TTS_CONFIG.MIN_SPEED && speed <= TTS_CONFIG.MAX_SPEED;
  return isValid ? speed : TTS_CONFIG.DEFAULT_SPEED;
}

function storedVoiceGender(): TTSVoiceGender {
  const gender = readStoredSetting(STORAGE_KEYS.TTS_VOICE_GENDER);
  return gender === 'MALE' || gender === 'FEMALE' ? gender : TTS_CONFIG.DEFAULT_VOICE_GENDER;
}

async function synthesizeClip({ text, speed }: { text: string; speed: number }): Promise<string | null> {
  if (!cleanTextForTTS(text)) return null;
  const data = await synthesizeSpeech({ text, speed, voiceGender: storedVoiceGender() });
  if (!data.audioContent) throw new Error(data.message || '音声データが空です');
  return data.audioContent;
}

function createClipAudio(clip: string): ReadAloudAudio {
  return new Audio(`data:audio/mp3;base64,${clip}`);
}

/** The reader's one read-aloud player, shared by every item's speaker button. */
export function useReadAloud() {
  const [player] = useState(() => createReadAloudPlayer({ synthesize: synthesizeClip, createAudio: createClipAudio }));
  const state = useSyncExternalStore(player.subscribe, player.getState, () => READ_ALOUD_IDLE);

  useEffect(() => {
    player.setSpeed(storedSpeed());
    return player.stop;
  }, [player]);

  return { state, toggle: player.toggle, stop: player.stop };
}
