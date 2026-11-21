import { describe, it, expect } from 'vitest';
import { bookAssetPath, bookImagePath, bookAssetUrl } from './bookAssetPath';

describe('bookAssetPath', () => {
  it('puts the sidecar beside a rephrase-furigana file in its book folder', () => {
    expect(bookAssetPath('bookv2-furigana/春の本', '春の本-rephrase-furigana', '.json')).toBe(
      '/bookv2-furigana/春の本/春の本.json'
    );
  });

  it('puts the sidecar beside a rephrase file in its book folder', () => {
    expect(bookAssetPath('bookv2-furigana/春の本', '春の本-rephrase', '.json')).toBe(
      '/bookv2-furigana/春の本/春の本.json'
    );
  });

  it('uses the book name as the subfolder for an original file', () => {
    expect(bookAssetPath('bookv2-furigana', '春の本', '.json')).toBe('/bookv2-furigana/春の本/春の本.json');
  });

  it('treats a rephrase suffix that is not at the end as part of the book name', () => {
    expect(bookAssetPath('d', '本-rephrase-メモ', '.json')).toBe('/d/本-rephrase-メモ/本-rephrase-メモ.json');
  });

  it('appends the extension as given', () => {
    expect(bookAssetPath('d/本', '本-rephrase-furigana', '-extra.json')).toBe('/d/本/本-extra.json');
  });
});

describe('bookImagePath', () => {
  it('uses a nested directory as the book folder', () => {
    expect(bookImagePath('bookv2-furigana/春の本', '春の本-rephrase-furigana', 'p1.png')).toBe(
      '/bookv2-furigana/春の本/images/p1.png'
    );
  });

  it('ignores the file name when the directory is nested', () => {
    expect(bookImagePath('bookv2-furigana/春の本', '別の名前', 'p1.png')).toBe('/bookv2-furigana/春の本/images/p1.png');
  });

  it('adds the book folder under a flat directory for a rephrase-furigana file', () => {
    expect(bookImagePath('bookv2-furigana', '春の本-rephrase-furigana', 'p1.png')).toBe(
      '/bookv2-furigana/春の本/images/p1.png'
    );
  });

  it('adds the book folder under a flat directory for a rephrase file', () => {
    expect(bookImagePath('bookv2-furigana', '春の本-rephrase', 'p1.png')).toBe('/bookv2-furigana/春の本/images/p1.png');
  });

  it('adds the book folder under a flat directory for an original file', () => {
    expect(bookImagePath('bookv2-furigana', '春の本', 'p1.png')).toBe('/bookv2-furigana/春の本/images/p1.png');
  });
});

describe('bookAssetUrl', () => {
  it('points at the book asset route with the encoded path', () => {
    expect(bookAssetUrl('/d/本/a.png')).toBe('/api/book-assets?path=%2Fd%2F%E6%9C%AC%2Fa.png');
  });

  it('round-trips a path with URL-reserved characters through the query string', () => {
    const assetPath = '/d/本 1 & 2?#+/images/a.png';
    const url = new URL(bookAssetUrl(assetPath), 'http://localhost');

    expect(url.searchParams.get('path')).toBe(assetPath);
  });
});
