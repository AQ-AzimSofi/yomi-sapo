import { THEME } from '@/lib/constants';

export type ReaderTheme = 'light' | 'dark';

type ThemeableDocument = {
  documentElement: { dataset: DOMStringMap };
  body: { style: { backgroundColor: string } };
};

/** The theme for the stored dark mode toggle, which holds 'true' or 'false'. */
export function readerThemeFrom(storedDarkMode: string | null): ReaderTheme {
  return storedDarkMode === 'true' ? 'dark' : 'light';
}

/**
 * Themes the whole document, so the theme also reaches the page ground and the scrollbars.
 * The returned cleanup hands the document back unthemed, keeping the other pages light.
 */
export function applyReaderTheme(doc: ThemeableDocument, theme: ReaderTheme): () => void {
  doc.documentElement.dataset.theme = theme;
  doc.body.style.backgroundColor = THEME.READER_BG;
  return () => {
    delete doc.documentElement.dataset.theme;
    doc.body.style.backgroundColor = '';
  };
}
