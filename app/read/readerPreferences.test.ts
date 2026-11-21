import { describe, expect, it } from 'vitest';
import { READER_CONFIG } from '@/lib/constants';
import { preferenceValue } from '@/lib/preferences';
import { READER_PREFERENCES } from './readerPreferences';

describe('READER_PREFERENCES keys', () => {
  it('keeps every preference under the key earlier versions stored it in', () => {
    const keys = Object.fromEntries(Object.entries(READER_PREFERENCES).map(([name, preference]) => [name, preference.key]));

    expect(keys).toStrictEqual({
      showFurigana: 'furigana_enabled',
      fontSize: 'reader_font_size',
      lineHeight: 'reader_line_height',
      displayMode: 'show_rephrase',
      aiExplanationEnabled: 'ai_explanation_enabled',
      readerTheme: 'reader_dark_mode',
      audiobookEnabled: 'audiobook_enabled',
      audiobookContentMode: 'audiobook_content_mode',
    });
  });
});

describe('READER_PREFERENCES defaults', () => {
  it('starts a reader with nothing stored on the same settings as before', () => {
    const defaults = Object.fromEntries(
      Object.entries(READER_PREFERENCES).map(([name, preference]) => [name, preference.defaultValue])
    );

    expect(defaults).toStrictEqual({
      showFurigana: false,
      fontSize: READER_CONFIG.DEFAULT_FONT_SIZE,
      lineHeight: READER_CONFIG.DEFAULT_LINE_HEIGHT,
      displayMode: 'collapsed',
      aiExplanationEnabled: false,
      readerTheme: 'light',
      audiobookEnabled: false,
      audiobookContentMode: 'main',
    });
  });
});

describe('READER_PREFERENCES.fontSize', () => {
  const { fontSize } = READER_PREFERENCES;

  it('reads a size the settings slider stored', () => {
    expect(preferenceValue(fontSize, '18')).toBe(18);
  });

  it('falls back to the default size for a value that is not a number', () => {
    expect(preferenceValue(fontSize, 'abc')).toBe(READER_CONFIG.DEFAULT_FONT_SIZE);
  });

  it('falls back to the default size for a size the slider cannot reach', () => {
    expect(preferenceValue(fontSize, '99')).toBe(READER_CONFIG.DEFAULT_FONT_SIZE);
  });

  it('stores a size the way the slider always stored it', () => {
    expect(fontSize.serialize(18)).toBe('18');
  });
});

describe('READER_PREFERENCES.lineHeight', () => {
  const { lineHeight } = READER_PREFERENCES;

  it('reads a line height the settings slider stored', () => {
    expect(preferenceValue(lineHeight, '1.5')).toBe(1.5);
  });

  it('falls back to the default line height for NaN', () => {
    expect(preferenceValue(lineHeight, 'NaN')).toBe(READER_CONFIG.DEFAULT_LINE_HEIGHT);
  });

  it('stores the slider step as a one-decimal string', () => {
    expect(lineHeight.serialize(21 / 10)).toBe('2.1');
  });
});

describe('READER_PREFERENCES.displayMode', () => {
  const { displayMode } = READER_PREFERENCES;

  it.each([['true', 'expanded'], ['false', 'collapsed'], ['maybe', 'collapsed']])(
    'reads a stored show_rephrase of %s as %s',
    (stored, mode) => {
      expect(preferenceValue(displayMode, stored)).toBe(mode);
    }
  );

  it.each([['expanded', 'true'], ['collapsed', 'false']] as const)('stores %s as show_rephrase %s', (mode, stored) => {
    expect(displayMode.serialize(mode)).toBe(stored);
  });
});

describe('READER_PREFERENCES.readerTheme', () => {
  const { readerTheme } = READER_PREFERENCES;

  it('reads a stored dark mode as the dark theme', () => {
    expect(preferenceValue(readerTheme, 'true')).toBe('dark');
  });

  it('reads a stored light mode as the light theme', () => {
    expect(preferenceValue(readerTheme, 'false')).toBe('light');
  });

  it('treats an unreadable dark mode value as light', () => {
    expect(preferenceValue(readerTheme, 'dark')).toBe('light');
  });

  it.each(['light', 'dark'] as const)('reads a stored %s theme back as the same theme', (theme) => {
    expect(preferenceValue(readerTheme, readerTheme.serialize(theme))).toBe(theme);
  });
});

describe('READER_PREFERENCES switches', () => {
  it.each(['showFurigana', 'aiExplanationEnabled', 'audiobookEnabled'] as const)(
    'reads %s from the true and false strings earlier versions stored',
    (name) => {
      const preference = READER_PREFERENCES[name];

      expect([preferenceValue(preference, 'true'), preferenceValue(preference, 'false')]).toStrictEqual([true, false]);
    }
  );
});

describe('READER_PREFERENCES.audiobookContentMode', () => {
  const { audiobookContentMode } = READER_PREFERENCES;

  it.each(['main', 'sub', 'both'])('reads the stored mode %s', (mode) => {
    expect(preferenceValue(audiobookContentMode, mode)).toBe(mode);
  });

  it('falls back to main for an unknown mode', () => {
    expect(preferenceValue(audiobookContentMode, 'loud')).toBe('main');
  });
});
