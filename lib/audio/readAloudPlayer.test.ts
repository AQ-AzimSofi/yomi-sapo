import { describe, expect, it } from 'vitest';
import { createReadAloudPlayer, type ReadAloudAudio } from './readAloudPlayer';

type AudioEvent = 'ended' | 'error';

class FakeAudio implements ReadAloudAudio {
  playbackRate = 1;
  isPlaying = false;
  private readonly listeners: Record<AudioEvent, Array<() => void>> = { ended: [], error: [] };

  constructor(readonly clip: string) {}

  play() {
    this.isPlaying = true;
    return Promise.resolve();
  }

  pause() {
    this.isPlaying = false;
  }

  addEventListener(type: AudioEvent, listener: () => void) {
    this.listeners[type].push(listener);
  }

  finish() {
    this.isPlaying = false;
    this.listeners.ended.forEach((listener) => listener());
  }
}

interface PendingClip {
  text: string;
  speed: number;
  resolve: (clip: string | null) => void;
}

function setUp({ holdClips = false } = {}) {
  const audios: FakeAudio[] = [];
  const pending: PendingClip[] = [];
  const player = createReadAloudPlayer({
    synthesize: ({ text, speed }) =>
      holdClips
        ? new Promise<string | null>((resolve) => pending.push({ text, speed, resolve }))
        : Promise.resolve(`clip:${text}`),
    createAudio: (clip) => {
      const audio = new FakeAudio(clip);
      audios.push(audio);
      return audio;
    },
  });
  return { player, audios, pending };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const playingClips = (audios: readonly FakeAudio[]) => audios.filter((audio) => audio.isPlaying).map((audio) => audio.clip);

describe('createReadAloudPlayer', () => {
  it('plays the clip of the item asked for', async () => {
    const { player, audios } = setUp();

    player.toggle(1, '一つ目。');
    expect(player.getState()).toEqual({ unitIndex: 1, status: 'loading' });
    await settle();

    expect(playingClips(audios)).toEqual(['clip:一つ目。']);
    expect(player.getState()).toEqual({ unitIndex: 1, status: 'playing' });
  });

  it('stops the item playing when another item starts, so only one plays', async () => {
    const { player, audios } = setUp();

    player.toggle(1, '一つ目。');
    await settle();
    player.toggle(2, '二つ目。');
    await settle();

    expect(playingClips(audios)).toEqual(['clip:二つ目。']);
    expect(player.getState()).toEqual({ unitIndex: 2, status: 'playing' });
  });

  it('never plays a clip that arrives after another item was started', async () => {
    const { player, audios, pending } = setUp({ holdClips: true });

    player.toggle(1, '一つ目。');
    player.toggle(2, '二つ目。');
    pending[1].resolve('clip:二つ目。');
    await settle();
    pending[0].resolve('clip:一つ目。');
    await settle();

    expect(audios.map((audio) => audio.clip)).toEqual(['clip:二つ目。']);
    expect(player.getState()).toEqual({ unitIndex: 2, status: 'playing' });
  });

  it('pauses and resumes the item when its own button is clicked again', async () => {
    const { player, audios } = setUp();
    player.toggle(1, '一つ目。');
    await settle();

    player.toggle(1, '一つ目。');
    expect(playingClips(audios)).toEqual([]);
    expect(player.getState()).toEqual({ unitIndex: 1, status: 'paused' });

    player.toggle(1, '一つ目。');
    await settle();
    expect(playingClips(audios)).toEqual(['clip:一つ目。']);
    expect(player.getState()).toEqual({ unitIndex: 1, status: 'playing' });
  });

  it('ignores a click on the item while its clip loads', async () => {
    const { player, pending } = setUp({ holdClips: true });

    player.toggle(1, '一つ目。');
    player.toggle(1, '一つ目。');

    expect(pending).toHaveLength(1);
    expect(player.getState()).toEqual({ unitIndex: 1, status: 'loading' });
  });

  it('goes idle when the clip ends', async () => {
    const { player, audios } = setUp();
    player.toggle(1, '一つ目。');
    await settle();

    audios[0].finish();

    expect(player.getState()).toEqual({ unitIndex: null, status: 'idle' });
  });

  it('silences the item and goes idle on stop', async () => {
    const { player, audios } = setUp();
    player.toggle(1, '一つ目。');
    await settle();

    player.stop();

    expect(playingClips(audios)).toEqual([]);
    expect(player.getState()).toEqual({ unitIndex: null, status: 'idle' });
  });

  it('goes idle without playing when there is nothing to say', async () => {
    const { player, audios, pending } = setUp({ holdClips: true });

    player.toggle(1, '[IMAGE:a.jpg]');
    pending[0].resolve(null);
    await settle();

    expect(audios).toEqual([]);
    expect(player.getState()).toEqual({ unitIndex: null, status: 'idle' });
  });

  it('tells subscribers about every change until they unsubscribe', async () => {
    const { player } = setUp();
    const seen: string[] = [];
    const unsubscribe = player.subscribe(() => seen.push(player.getState().status));

    player.toggle(1, '一つ目。');
    await settle();
    unsubscribe();
    player.stop();

    expect(seen).toEqual(['loading', 'playing']);
  });
});
