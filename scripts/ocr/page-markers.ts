export const CONTINUATION_MARKER = '<<CONTINUED>>';

const MARKER_PATTERN = /<<[A-Z_]+[^>\n]*>>/;

// Only a leading continuation marker is read back when pages are joined. A marker anywhere
// else (a figure mid-line, a continuation after a figure) would reach the book as literal text.
export function findStrayMarker(pageText: string): string | undefined {
  const body = pageText.startsWith(CONTINUATION_MARKER) ? pageText.slice(CONTINUATION_MARKER.length) : pageText;
  return MARKER_PATTERN.exec(body)?.[0];
}
