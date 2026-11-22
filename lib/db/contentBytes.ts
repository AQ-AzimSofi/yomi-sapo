/**
 * text_entries.content_bytes is the byte size of the text the row's page counts were computed from,
 * and on Aurora DSQL the library trusts those counts while content_bytes is set. A row copied to
 * another database keeps content_bytes only while it equals the size of the row's text; otherwise
 * it is copied as NULL, so the library there recounts the book.
 */
export function withCurrentContentBytes<Row extends Record<string, unknown>>(row: Row): Row {
  const { content, content_bytes: contentBytes } = row;
  if (contentBytes === null || contentBytes === undefined) return row;
  if (typeof content === 'string' && Number(contentBytes) === Buffer.byteLength(content, 'utf8')) return row;
  return { ...row, content_bytes: null };
}
