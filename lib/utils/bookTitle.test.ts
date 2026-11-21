import { describe, it, expect } from 'vitest';
import { formatBookTitle } from './bookTitle';

describe('formatBookTitle', () => {
  it('strips the -rephrase-furigana suffix', () => {
    expect(formatBookTitle('春の本-rephrase-furigana')).toBe('春の本');
  });

  it('strips the -rephrase suffix', () => {
    expect(formatBookTitle('春の本-rephrase')).toBe('春の本');
  });

  it('strips the -furigana suffix', () => {
    expect(formatBookTitle('春の本-furigana')).toBe('春の本');
  });

  it('keeps a suffix word that is not at the end', () => {
    expect(formatBookTitle('春-rephrase-メモ')).toBe('春 rephrase メモ');
  });

  it('turns hyphens into spaces', () => {
    expect(formatBookTitle('春-の-本')).toBe('春 の 本');
  });

  it('keeps spaces already in the name', () => {
    expect(formatBookTitle('春の本 1 Ars longa-rephrase-furigana')).toBe('春の本 1 Ars longa');
  });

  it('capitalizes a leading latin letter', () => {
    expect(formatBookTitle('my-book-rephrase-furigana')).toBe('My book');
  });

  it('leaves a title that starts with Japanese unchanged', () => {
    expect(formatBookTitle('春の本')).toBe('春の本');
  });
});
