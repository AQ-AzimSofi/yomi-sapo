import { brotliCompressSync, constants } from 'node:zlib';

/** Aurora DSQL refuses a value larger than this after its lz4 compression (SQLSTATE 54000). */
export const MAX_STORED_TEXT_BYTES = 1024 * 1024;

// Node has no lz4, so brotli at its fastest setting measures how well a text compresses.
// Raw bytes cannot set the limit: DSQL keeps 22% to 48% of a book's raw bytes, so 2.6 MB of
// the least compressible books did not fit while the 3.61 MB largest book did (0.96 MB stored).
// For the local books DSQL stored 1.28 to 1.37 bytes per brotli byte; 1.45 adds margin over the worst.
const STORED_BYTES_PER_BROTLI_BYTE = 1.45;

/**
 * An upper estimate of the bytes Aurora DSQL needs to store the text in one value. DSQL keeps a
 * value uncompressed when compression cannot shrink it, so the raw size is an upper bound too.
 */
export function estimateStoredBytes(text: string): number {
  const rawBytes = Buffer.from(text, 'utf8');
  const brotliBytes = brotliCompressSync(rawBytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 0 } }).length;
  return Math.min(rawBytes.length, Math.ceil(brotliBytes * STORED_BYTES_PER_BROTLI_BYTE));
}

export class BookTextTooLargeError extends Error {
  name = 'BookTextTooLargeError';
  readonly estimatedStoredBytes: number;

  constructor(estimatedStoredBytes: number) {
    super(
      `Book text is too large to store: about ${estimatedStoredBytes.toLocaleString('en-US')} bytes after compression, ` +
        `over the ${MAX_STORED_TEXT_BYTES.toLocaleString('en-US')}-byte limit of one database value. Split the book into parts.`
    );
    this.estimatedStoredBytes = estimatedStoredBytes;
  }
}

/**
 * Refuses book text that might not fit in one Aurora DSQL value. It applies on Neon too, so no
 * book is saved there that could not move to DSQL.
 */
export function assertBookTextFits(text: string): void {
  const estimatedStoredBytes = estimateStoredBytes(text);
  if (estimatedStoredBytes <= MAX_STORED_TEXT_BYTES) return;
  throw new BookTextTooLargeError(estimatedStoredBytes);
}
