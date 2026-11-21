import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { getBookmark } from '@/lib/db/queries';
import { bookQuery, type BookRef } from '@/lib/books/bookRef';
import { GET } from './route';

vi.mock('@/lib/db/queries', () => ({ getBookmark: vi.fn() }));

const OWNER_HEADERS = await ownerSessionHeaders();
const BOOK: BookRef = { directory: 'bookv2-furigana/ほん (文庫)', fileName: 'ほん (文庫)-rephrase-furigana' };

function separateRequest(book: BookRef): Request {
  return new Request(`http://localhost/api/read-bookmark?${bookQuery(book)}`, { headers: OWNER_HEADERS });
}

function combinedRequest(bookKey: string): Request {
  return new Request(`http://localhost/api/read-bookmark?fileName=${encodeURIComponent(bookKey)}`, { headers: OWNER_HEADERS });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.mocked(getBookmark).mockResolvedValue({ text: '一文目', page: 3 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/read-bookmark', () => {
  it('reads the bookmark of a book sent as separate directory and fileName', async () => {
    const response = await GET(separateRequest(BOOK));

    expect(await response.json()).toStrictEqual({ text: '一文目', page: 3 });
    expect(getBookmark).toHaveBeenCalledWith(BOOK.fileName, BOOK.directory);
  });

  it('reads the same bookmark from the combined fileName=dir/file form', async () => {
    await GET(combinedRequest(`${BOOK.directory}/${BOOK.fileName}`));

    expect(getBookmark).toHaveBeenCalledWith(BOOK.fileName, BOOK.directory);
  });

  it('reads a combined name without a slash from the legacy public folder', async () => {
    await GET(combinedRequest('text-1'));

    expect(getBookmark).toHaveBeenCalledWith('text-1', 'public');
  });

  // Matches the key the old combined path resolved to, so existing rows keep matching.
  it('moves a slash in a separate fileName into the directory', async () => {
    await GET(separateRequest({ directory: 'bookv2-furigana', fileName: '感謝脳/感謝脳-rephrase-furigana' }));

    expect(getBookmark).toHaveBeenCalledWith('感謝脳-rephrase-furigana', 'bookv2-furigana/感謝脳');
  });

  it.each([
    ['no fileName', new Request('http://localhost/api/read-bookmark?directory=bookv2-furigana', { headers: OWNER_HEADERS })],
    ['a combined path that climbs out of the book folders', combinedRequest('bookv2-furigana/../secret')],
    ['a directory with a .. segment', separateRequest({ directory: 'bookv2-furigana/..', fileName: 'secret' })],
    ['a leading slash', separateRequest({ directory: '/bookv2-furigana', fileName: 'ほん' })],
  ])('answers 400 without reading for %s', async (_case, request) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(getBookmark).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
