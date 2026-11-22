import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/lib/constants';
import { synthesizeSpeech } from '@/lib/api/client';
import { synthesizeClip } from './useReadAloud';

vi.mock('@/lib/api/client', () => ({
  synthesizeSpeech: vi.fn(async () => ({ audioContent: 'clip', message: 'ok' })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('synthesizeClip', () => {
  it('Test_synthesizeClip_AsksForNormalSpeedWhateverSpeedIsStored', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === STORAGE_KEYS.TTS_SPEED ? '1.5' : null) });

    await synthesizeClip('一つ目。');

    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: '一つ目。', speed: 1 }));
  });
});
