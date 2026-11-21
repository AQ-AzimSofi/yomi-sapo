import { describe, expect, it } from 'vitest';
import {
  LEGACY_BOOK_DIRECTORY,
  bookQuery,
  bookRefFromParams,
  isSafeBookRef,
  parseBookKey,
  rubyRegistryKey,
  sameBook,
  toBookKey,
  type BookRef,
} from './bookRef';

// Shapes copied from text_entries and bookmarks rows.
const NESTED_BOOK: BookRef = {
  directory: 'bookv2-furigana/幼女戦記 1 Deus lo vult',
  fileName: '幼女戦記 1 Deus lo vult-rephrase-furigana',
};
const FLAT_BOOK: BookRef = { directory: 'bookv1-rephrase', fileName: 'readable-code' };
const STORED_BOOKS: [string, BookRef][] = [
  ['a nested rephrase book with spaces', NESTED_BOOK],
  ['a flat book', FLAT_BOOK],
  ['a flat book with full-width parentheses', { directory: 'bookv2-furigana', fileName: 'すべては見方次第 小林正観さんから教わったこと (扶桑社ＢＯＯＫＳ)' }],
  [
    'a nested book with full-width letters and ASCII parentheses',
    { directory: 'bookv2-furigana/ＷＨＩＴＥ ＡＬＢＵＭ２ 雪が紡ぐ旋律１ (GA文庫)', fileName: 'ＷＨＩＴＥ ＡＬＢＵＭ２ 雪が紡ぐ旋律１ (GA文庫)-rephrase-furigana' },
  ],
  ['a nested book with full-width parentheses', { directory: 'bookv2-furigana/自分に気づく心理学（愛蔵版）', fileName: '自分に気づく心理学（愛蔵版）-rephrase' }],
  [
    'a nested book with brackets, a wave dash and hyphens',
    {
      directory: 'bookv2-furigana/よって、初恋は証明された。 -デルタとガンマの理学部ノート１- (電撃文庫)',
      fileName: 'よって、初恋は証明された。 -デルタとガンマの理学部ノート１- (電撃文庫)-rephrase-furigana',
    },
  ],
  ['a nested book with lenticular brackets', { directory: 'bookv2-furigana/貞操逆転世界ならモテると思っていたら【電子特別版】', fileName: '貞操逆転世界ならモテると思っていたら【電子特別版】-rephrase-furigana' }],
];

describe('toBookKey', () => {
  it('joins the directory and the file name with a slash', () => {
    expect(toBookKey(FLAT_BOOK)).toBe('bookv1-rephrase/readable-code');
  });
});

describe('parseBookKey', () => {
  it('takes the last segment as the file and the rest as the directory', () => {
    expect(parseBookKey('bookv2-furigana/ほん/ほん-rephrase-furigana')).toStrictEqual({
      directory: 'bookv2-furigana/ほん',
      fileName: 'ほん-rephrase-furigana',
    });
  });

  it.each(STORED_BOOKS)('reads back the key of %s', (_case, book) => {
    expect(parseBookKey(toBookKey(book))).toStrictEqual(book);
  });

  it('places a key without a directory in the legacy public folder', () => {
    expect(parseBookKey('text-1')).toStrictEqual({ directory: LEGACY_BOOK_DIRECTORY, fileName: 'text-1' });
    expect(LEGACY_BOOK_DIRECTORY).toBe('public');
  });

  // Old bookmark rows stored the book folder in file_name. The bookmark routes have
  // always split at the last slash, so such a key names the nested book instead.
  it('reads the key of a legacy bookmark row with a slash in its file name as the nested book', () => {
    const legacyRow = { directory: 'bookv2-furigana', fileName: '感謝脳/感謝脳-rephrase-furigana' };

    expect(parseBookKey(toBookKey(legacyRow))).toStrictEqual({ directory: 'bookv2-furigana/感謝脳', fileName: '感謝脳-rephrase-furigana' });
  });

  it('keeps an empty file name after a trailing slash, for the validator to reject', () => {
    expect(parseBookKey('bookv2-furigana/')).toStrictEqual({ directory: 'bookv2-furigana', fileName: '' });
  });
});

describe('bookRefFromParams', () => {
  it('reads separate directory and fileName params', () => {
    expect(bookRefFromParams(NESTED_BOOK.directory, NESTED_BOOK.fileName)).toStrictEqual(NESTED_BOOK);
  });

  it('reads the combined fileName=dir/file form the same as the separate params', () => {
    expect(bookRefFromParams(null, toBookKey(NESTED_BOOK))).toStrictEqual(NESTED_BOOK);
  });

  it('treats an empty directory param as absent', () => {
    expect(bookRefFromParams('', toBookKey(FLAT_BOOK))).toStrictEqual(FLAT_BOOK);
  });

  it('moves a slash in the file name into the directory, as the joined key always did', () => {
    expect(bookRefFromParams('bookv2-furigana', '感謝脳/感謝脳-rephrase-furigana')).toStrictEqual({
      directory: 'bookv2-furigana/感謝脳',
      fileName: '感謝脳-rephrase-furigana',
    });
  });

  it('places a lone file name in the legacy public folder', () => {
    expect(bookRefFromParams(undefined, 'text-1')).toStrictEqual({ directory: 'public', fileName: 'text-1' });
  });
});

describe('sameBook', () => {
  it('matches the same directory and file name', () => {
    expect(sameBook(NESTED_BOOK, { ...NESTED_BOOK })).toBe(true);
  });

  it('tells apart another file in the same directory', () => {
    expect(sameBook(NESTED_BOOK, { ...NESTED_BOOK, fileName: '幼女戦記 1 Deus lo vult' })).toBe(false);
  });

  it('tells apart the same file name in the parent directory', () => {
    expect(sameBook(NESTED_BOOK, { ...NESTED_BOOK, directory: 'bookv2-furigana' })).toBe(false);
  });

  it('tells apart a legacy row whose joined key equals the nested book', () => {
    const legacyRow = { directory: 'bookv2-furigana', fileName: '幼女戦記 1 Deus lo vult/幼女戦記 1 Deus lo vult-rephrase-furigana' };

    expect(sameBook(NESTED_BOOK, legacyRow)).toBe(false);
  });
});

describe('isSafeBookRef', () => {
  it.each(STORED_BOOKS)('accepts %s', (_case, book) => {
    expect(isSafeBookRef(book)).toBe(true);
  });

  it('accepts a book in the legacy public folder', () => {
    expect(isSafeBookRef(parseBookKey('text-1'))).toBe(true);
  });

  it('accepts dots inside a name', () => {
    expect(isSafeBookRef({ directory: 'bookv2-furigana/それは...', fileName: 'それは...-rephrase' })).toBe(true);
  });

  it.each([
    ['a .. directory segment', { directory: 'bookv2-furigana/..', fileName: 'secret' }],
    ['a .. segment that climbs back into a book', { directory: 'bookv2-furigana/x/../ほん', fileName: 'ほん-rephrase' }],
    ['a .. file name', { directory: 'bookv2-furigana', fileName: '..' }],
    ['a leading slash', { directory: '/bookv2-furigana/ほん', fileName: 'ほん-rephrase' }],
    ['an empty directory', { directory: '', fileName: 'ほん-rephrase' }],
    ['an empty file name', { directory: 'bookv2-furigana/ほん', fileName: '' }],
    ['a doubled slash', { directory: 'bookv2-furigana//ほん', fileName: 'ほん-rephrase' }],
    ['a trailing slash on the directory', { directory: 'bookv2-furigana/ほん/', fileName: 'ほん-rephrase' }],
    ['a backslash, which Windows reads as a separator', { directory: 'bookv2-furigana\\..', fileName: 'secret' }],
  ])('rejects %s', (_case, book) => {
    expect(isSafeBookRef(book)).toBe(false);
  });
});

describe('bookQuery', () => {
  it('encodes the directory and file name as separate params', () => {
    expect(bookQuery({ directory: 'd/本', fileName: 'a b&c' })).toBe('directory=d%2F%E6%9C%AC&fileName=a%20b%26c');
  });

  it.each(STORED_BOOKS)('reads back %s from its query', (_case, book) => {
    const params = new URLSearchParams(bookQuery(book));

    expect(bookRefFromParams(params.get('directory'), params.get('fileName') ?? '')).toStrictEqual(book);
  });
});

describe('rubyRegistryKey', () => {
  it('splits a nested book folder into its top directory and the book name', () => {
    expect(rubyRegistryKey(NESTED_BOOK)).toStrictEqual({ directory: 'bookv2-furigana', bookName: '幼女戦記 1 Deus lo vult' });
  });

  it('gives a flat book no book name', () => {
    expect(rubyRegistryKey(FLAT_BOOK)).toStrictEqual({ directory: 'bookv1-rephrase', bookName: '' });
  });

  it('keeps every folder below the top directory in the book name', () => {
    expect(rubyRegistryKey({ directory: 'a/b/c', fileName: 'f' })).toStrictEqual({ directory: 'a', bookName: 'b/c' });
  });
});
