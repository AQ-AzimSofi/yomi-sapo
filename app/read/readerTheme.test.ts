import { describe, expect, it } from 'vitest';
import { readerThemeFrom } from './readerTheme';

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
