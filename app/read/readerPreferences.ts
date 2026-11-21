import { READER_CONFIG, STORAGE_KEYS } from '@/lib/constants';
import { choicePreference, numberPreference, switchPreference } from '@/lib/preferences';
import type { AudioBookContentMode } from '@/lib/types';
import type { ReaderTheme } from './readerTheme';

export type DisplayMode = 'collapsed' | 'expanded';

/** Every reader setting kept between visits, under the keys and formats earlier versions stored. */
export const READER_PREFERENCES = {
  showFurigana: switchPreference({ key: STORAGE_KEYS.FURIGANA_ENABLED, on: true, off: false, defaultValue: false }),
  fontSize: numberPreference({
    key: STORAGE_KEYS.READER_FONT_SIZE,
    min: READER_CONFIG.MIN_FONT_SIZE,
    max: READER_CONFIG.MAX_FONT_SIZE,
    defaultValue: READER_CONFIG.DEFAULT_FONT_SIZE,
  }),
  lineHeight: numberPreference({
    key: STORAGE_KEYS.READER_LINE_HEIGHT,
    min: READER_CONFIG.MIN_LINE_HEIGHT,
    max: READER_CONFIG.MAX_LINE_HEIGHT,
    defaultValue: READER_CONFIG.DEFAULT_LINE_HEIGHT,
  }),
  // Stored under the show_rephrase switch, which predates the two display modes.
  displayMode: switchPreference<DisplayMode>({
    key: STORAGE_KEYS.SHOW_REPHRASE,
    on: 'expanded',
    off: 'collapsed',
    defaultValue: 'collapsed',
  }),
  aiExplanationEnabled: switchPreference({ key: STORAGE_KEYS.AI_EXPLANATION_ENABLED, on: true, off: false, defaultValue: false }),
  // Stored under the dark mode switch, which predates the theme names.
  readerTheme: switchPreference<ReaderTheme>({ key: STORAGE_KEYS.READER_DARK_MODE, on: 'dark', off: 'light', defaultValue: 'light' }),
  audiobookEnabled: switchPreference({ key: STORAGE_KEYS.AUDIOBOOK_ENABLED, on: true, off: false, defaultValue: false }),
  audiobookContentMode: choicePreference<AudioBookContentMode>({
    key: STORAGE_KEYS.AUDIOBOOK_CONTENT_MODE,
    choices: ['main', 'sub', 'both'],
    defaultValue: 'main',
  }),
};
