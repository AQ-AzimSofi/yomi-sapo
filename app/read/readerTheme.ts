export type ReaderTheme = 'light' | 'dark';

/** The theme for the stored dark mode toggle, which holds 'true' or 'false'. */
export function readerThemeFrom(storedDarkMode: string | null): ReaderTheme {
  return storedDarkMode === 'true' ? 'dark' : 'light';
}
