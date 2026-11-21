/**
 * The reader's one read-aloud player. Every item's speaker button goes through it,
 * and starting an item stops the one before, so two items never play at once.
 * It knows nothing of React, so the rule is testable; useReadAloud binds it to the reader.
 */

export type ReadAloudStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface ReadAloudState {
  unitIndex: number | null;
  status: ReadAloudStatus;
}

export const READ_ALOUD_IDLE: ReadAloudState = { unitIndex: null, status: 'idle' };

/** The part of an audio element the player uses. */
export interface ReadAloudAudio {
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface ReadAloudDeps {
  /** The clip (base64 MP3) for a text at a speed, or null when the text has nothing to say. */
  synthesize: (request: { text: string; speed: number }) => Promise<string | null>;
  createAudio: (clip: string) => ReadAloudAudio;
}

export interface ReadAloudPlayer {
  getState: () => ReadAloudState;
  subscribe: (listener: () => void) => () => void;
  /** Starts the unit, or pauses or resumes it when it is the unit already playing. */
  toggle: (unitIndex: number, text: string) => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
}

interface Session {
  // Raised by every start and stop, so a clip or a play() that settles late for an
  // earlier request can tell it no longer has the player.
  token: number;
  audio: ReadAloudAudio | null;
  state: ReadAloudState;
  speed: number;
}

export function createReadAloudPlayer({ synthesize, createAudio }: ReadAloudDeps): ReadAloudPlayer {
  const listeners = new Set<() => void>();
  const session: Session = { token: 0, audio: null, state: READ_ALOUD_IDLE, speed: 1 };

  const update = (state: ReadAloudState) => {
    session.state = state;
    listeners.forEach((listener) => listener());
  };

  const silence = () => {
    session.audio?.pause();
    session.audio = null;
  };

  const takeOver = () => {
    session.token += 1;
    silence();
    return session.token;
  };

  const failIfCurrent = (token: number, error: unknown) => {
    if (token !== session.token) return;
    console.error('Read-aloud failed:', error);
    silence();
    update(READ_ALOUD_IDLE);
  };

  const start = async (unitIndex: number, text: string) => {
    const token = takeOver();
    update({ unitIndex, status: 'loading' });
    try {
      const clip = await synthesize({ text, speed: session.speed });
      if (token !== session.token) return;
      if (!clip) {
        update(READ_ALOUD_IDLE);
        return;
      }
      const audio = createAudio(clip);
      audio.playbackRate = session.speed;
      const finish = () => {
        if (token !== session.token) return;
        session.audio = null;
        update(READ_ALOUD_IDLE);
      };
      audio.addEventListener('ended', finish);
      audio.addEventListener('error', finish);
      session.audio = audio;
      await audio.play();
      if (token !== session.token) return;
      update({ unitIndex, status: 'playing' });
    } catch (error) {
      failIfCurrent(token, error);
    }
  };

  const resume = async (unitIndex: number) => {
    const audio = session.audio;
    if (!audio) {
      update(READ_ALOUD_IDLE);
      return;
    }
    const token = session.token;
    update({ unitIndex, status: 'playing' });
    try {
      await audio.play();
    } catch (error) {
      failIfCurrent(token, error);
    }
  };

  const toggle = (unitIndex: number, text: string) => {
    const { state } = session;
    if (state.unitIndex !== unitIndex) {
      void start(unitIndex, text);
      return;
    }
    if (state.status === 'loading') return;
    if (state.status === 'playing') {
      session.audio?.pause();
      update({ unitIndex, status: 'paused' });
      return;
    }
    void resume(unitIndex);
  };

  const stop = () => {
    takeOver();
    update(READ_ALOUD_IDLE);
  };

  const setSpeed = (speed: number) => {
    session.speed = speed;
    if (session.audio) session.audio.playbackRate = speed;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState: () => session.state, subscribe, toggle, stop, setSpeed };
}
