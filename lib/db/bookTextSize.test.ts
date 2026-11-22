import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  assertBookTextFits,
  BookTextTooLargeError,
  bookTextTooLargeError,
  estimateStoredBytes,
  MAX_STORED_TEXT_BYTES,
} from './bookTextSize';

// Printable ASCII in random order barely compresses, like the random values that found DSQL's exact 1 MiB cut.
function incompressibleText(bytes: number): string {
  return Array.from(randomBytes(bytes), (byte) => String.fromCharCode(33 + (byte % 94))).join('');
}

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('estimateStoredBytes', () => {
  it('never estimates more than the raw UTF-8 bytes, which DSQL stores when compression cannot help', () => {
    expect(estimateStoredBytes(incompressibleText(200_000))).toBe(200_000);
    expect(estimateStoredBytes('本文')).toBe(6);
  });

  it('estimates a repetitive text far below its raw size', () => {
    const text = '吾輩は猫である。名前はまだ無い。\n'.repeat(100_000);

    expect(estimateStoredBytes(text)).toBeLessThan(Buffer.byteLength(text) / 50);
  });
});

describe('bookTextTooLargeError', () => {
  it('is null for text that fits', () => {
    expect(bookTextTooLargeError(incompressibleText(MAX_STORED_TEXT_BYTES))).toBeNull();
  });

  it('is the error that refuses text over the cap', () => {
    expect(bookTextTooLargeError(incompressibleText(MAX_STORED_TEXT_BYTES + 1))?.estimatedStoredBytes).toBe(MAX_STORED_TEXT_BYTES + 1);
  });
});

describe('assertBookTextFits', () => {
  it('accepts incompressible text up to the 1 MiB cap', () => {
    expect(() => assertBookTextFits(incompressibleText(MAX_STORED_TEXT_BYTES))).not.toThrow();
  });

  it('refuses incompressible text one byte over the cap', () => {
    expect(() => assertBookTextFits(incompressibleText(MAX_STORED_TEXT_BYTES + 1))).toThrow(BookTextTooLargeError);
  });

  it('accepts a 12 MB text that compresses well, as DSQL does', () => {
    expect(() => assertBookTextFits('あ'.repeat(4 * 1024 * 1024))).not.toThrow();
  });

  it('says how large the text is estimated to be and what the limit is', () => {
    const error = thrownBy(() => assertBookTextFits(incompressibleText(1_100_000)));

    expect(error).toBeInstanceOf(BookTextTooLargeError);
    expect((error as BookTextTooLargeError).estimatedStoredBytes).toBe(1_100_000);
    expect((error as Error).message).toBe(
      'Book text is too large to store: about 1,100,000 bytes after compression, over the 1,048,576-byte limit of one database value. Split the book into parts.'
    );
  });
});

// Reads the largest book, read-only, from BOOK_TEXT_TEST_DATABASE_URL (the local Docker database).
const BOOK_DATABASE_URL = process.env.BOOK_TEXT_TEST_DATABASE_URL ?? '';

describe.skipIf(!BOOK_DATABASE_URL)('assertBookTextFits on the largest stored book', () => {
  async function readLargestBook(): Promise<string> {
    const sql = postgres(BOOK_DATABASE_URL, { max: 1, connection: { default_transaction_read_only: true } });
    try {
      const [book] = await sql<{ content: string }[]>`
        SELECT content FROM text_entries ORDER BY octet_length(content) DESC LIMIT 1
      `;
      return book.content;
    } finally {
      await sql.end();
    }
  }

  it('accepts it, and refuses it grown by a tenth, which DSQL also refused', async () => {
    const book = await readLargestBook();
    const grownBook = book + book.slice(0, Math.ceil(book.length / 10));

    expect(estimateStoredBytes(book)).toBeLessThanOrEqual(MAX_STORED_TEXT_BYTES);
    expect(() => assertBookTextFits(book)).not.toThrow();
    expect(() => assertBookTextFits(grownBook)).toThrow(BookTextTooLargeError);
  }, 30_000);
});
