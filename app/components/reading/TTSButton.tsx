'use client';

import type { MouseEvent } from 'react';
import SpeakerIcon from '@/app/components/icons/SpeakerIcon';
import { THEME } from '@/lib/constants';
import { toTint } from '@/lib/utils/colorTint';
import type { ReadAloudStatus } from '@/lib/audio/readAloudPlayer';

interface TTSButtonProps {
  status: ReadAloudStatus;
  onToggle: () => void;
  onStop: () => void;
}

const TITLES: Record<ReadAloudStatus, string> = {
  idle: '読み上げる',
  loading: '読み込み中...',
  playing: '一時停止 (ダブルクリックで停止)',
  paused: '再開 (ダブルクリックで停止)',
};

/**
 * An item's read-aloud button, drawn from the reader's player state.
 * A click plays, pauses or resumes the item; a double click stops it.
 */
export default function TTSButton({ status, onToggle, onStop }: TTSButtonProps) {
  const isLoading = status === 'loading';
  const isActive = status === 'playing' || status === 'paused';

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isLoading) return;
    onToggle();
  };

  const handleDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onStop();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      disabled={isLoading}
      className={`
        w-6 h-6
        flex items-center justify-center
        transition-colors duration-200
        ${isLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
      `}
      style={{
        backgroundColor: isActive ? toTint(THEME.PRIMARY, 12) : 'transparent',
        borderBottom: `2px solid ${isActive ? THEME.PRIMARY : 'transparent'}`,
      }}
      title={TITLES[status]}
    >
      <SpeakerIcon isPlaying={status === 'playing'} isLoading={isLoading} />
    </button>
  );
}
