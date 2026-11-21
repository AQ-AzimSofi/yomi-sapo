import { stripFurigana } from '@/lib/utils/furiganaParser';
import { pageStartIndex } from './bookModel';

const IMAGE_MARKER = /\[IMAGE:[^\]]+\]/g;

/**
 * The text the reader puts on the clipboard for a run of pages: one line per
 * unit line, without furigana and without the illustration markers, which only
 * mean something to the reader. A line that held nothing but a marker is dropped.
 */
export function copyTextForPages(mainTexts: readonly string[], firstPage: number, lastPage: number): string {
  return mainTexts
    .slice(pageStartIndex(firstPage), pageStartIndex(lastPage + 1))
    .map((text) => stripFurigana(text.replace(IMAGE_MARKER, '')))
    .flatMap((text) => text.split('\n'))
    .filter((line) => line.trim().length > 0)
    .join('\n');
}
