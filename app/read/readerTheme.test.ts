import { describe, expect, it } from 'vitest';
import { THEME } from '@/lib/constants';
import { applyReaderTheme, readerThemeFrom, storedDarkModeFor } from './readerTheme';

describe('readerThemeFrom', () => {
  it('reads a stored dark mode as the dark theme', () => {
    expect(readerThemeFrom('true')).toBe('dark');
  });

  it('reads a stored light mode as the light theme', () => {
    expect(readerThemeFrom('false')).toBe('light');
  });

  it('starts a reader with no stored preference in the light theme', () => {
    expect(readerThemeFrom(null)).toBe('light');
  });

  it('treats an unreadable preference as light', () => {
    expect(readerThemeFrom('dark')).toBe('light');
  });
});

describe('storedDarkModeFor', () => {
  it('stores the dark theme as the value earlier versions stored for dark mode', () => {
    expect(storedDarkModeFor('dark')).toBe('true');
  });

  it('stores the light theme as the value earlier versions stored for light mode', () => {
    expect(storedDarkModeFor('light')).toBe('false');
  });

  it.each(['light', 'dark'] as const)('reads a stored %s theme back as the same theme', (theme) => {
    expect(readerThemeFrom(storedDarkModeFor(theme))).toBe(theme);
  });
});

function unthemedDocument() {
  return { documentElement: { dataset: {} }, body: { style: { backgroundColor: '' } } };
}

describe('applyReaderTheme', () => {
  it('marks the document element with the theme', () => {
    const doc = unthemedDocument();

    applyReaderTheme(doc, 'dark');

    expect(doc.documentElement.dataset).toStrictEqual({ theme: 'dark' });
  });

  it('grounds the page in the reader background', () => {
    const doc = unthemedDocument();

    applyReaderTheme(doc, 'dark');

    expect(doc.body.style.backgroundColor).toBe(THEME.READER_BG);
  });

  it('hands the document back unthemed when the reader closes', () => {
    const doc = unthemedDocument();

    const removeTheme = applyReaderTheme(doc, 'dark');
    removeTheme();

    expect(doc).toStrictEqual(unthemedDocument());
  });
});
