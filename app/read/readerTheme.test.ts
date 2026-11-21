import { describe, expect, it } from 'vitest';
import { THEME } from '@/lib/constants';
import { applyReaderTheme } from './readerTheme';

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
