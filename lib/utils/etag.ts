// The reader's stored ETag. CloudFront drops If-None-Match before it reaches the
// app, but forwards custom headers.
export const BOOK_VERSION_HEADER = 'x-book-version';

// RFC 9110 weak comparison. CloudFront marks an ETag weak (W/"...") when it
// compresses the response, and a header may list several tags or be "*".
export function ifNoneMatchIncludes(header: string | null, etag: string): boolean {
  if (!header) return false;
  const opaqueTag = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === opaqueTag);
}
