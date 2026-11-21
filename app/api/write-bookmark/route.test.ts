import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { upsertBookmark } from '@/lib/db/queries';
import { POST } from './route';

vi.mock('@/lib/db/queries', () => ({ upsertBookmark: vi.fn() }));

const TARGET = 'bookv2-furigana/ほん/ほん-rephrase-furigana';
const BOOK = { directory: 'bookv2-furigana/ほん', fileName: 'ほん-rephrase-furigana' };
const OWNER_HEADERS = await ownerSessionHeaders();

function bookmarkRequest(body: unknown, sessionHeaders: Record<string, string> = OWNER_HEADERS): Request {
  return new Request('http://localhost/api/write-bookmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/write-bookmark', () => {
  it.each([1, 7])('saves the bookmark with the reader page it sits on (%s)', async (page) => {
    const response = await POST(bookmarkRequest({ target: TARGET, content: '一文目', page }));

    expect(response.status).toBe(200);
    expect(upsertBookmark).toHaveBeenCalledWith({
      fileName: 'ほん-rephrase-furigana',
      directory: 'bookv2-furigana/ほん',
      bookmarkText: '一文目',
      bookmarkPage: page,
    });
  });

  it.each([0, -2, 2.5, '3'])('drops an invalid page (%s) so the library recounts it, and warns', async (page) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await POST(bookmarkRequest({ target: TARGET, content: '一文目', page }));

    expect(upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ bookmarkPage: undefined }));
    expect(warn).toHaveBeenCalledWith('Ignoring an invalid bookmark page:', { book: TARGET, page });
    warn.mockRestore();
  });

  it('saves a bookmark sent without a page, without a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await POST(bookmarkRequest({ target: TARGET, content: '一文目', page: null }));

    expect(upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ bookmarkPage: undefined }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects a guest without saving', async () => {
    const response = await POST(bookmarkRequest({ target: TARGET, content: '一文目', page: 7 }, {}));

    expect(response.status).toBe(401);
    expect(upsertBookmark).not.toHaveBeenCalled();
  });

  it.each([
    ['no target', { content: '一文目' }],
    ['no content', { target: TARGET }],
    ['content that is not text', { target: TARGET, content: 7 }],
  ])('answers 400 without saving for a body with %s', async (_case, body) => {
    const response = await POST(bookmarkRequest(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_body');
    expect(upsertBookmark).not.toHaveBeenCalled();
  });

  it('accepts a bookmark with empty text, as before', async () => {
    const response = await POST(bookmarkRequest({ target: TARGET, content: '' }));

    expect(response.status).toBe(200);
    expect(upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ bookmarkText: '' }));
  });

  it('saves a bookmark sent with separate directory and fileName under the same key as the combined target', async () => {
    const response = await POST(bookmarkRequest({ ...BOOK, content: '一文目', page: 7 }));

    expect(response.status).toBe(200);
    expect(upsertBookmark).toHaveBeenCalledWith({
      fileName: BOOK.fileName,
      directory: BOOK.directory,
      bookmarkText: '一文目',
      bookmarkPage: 7,
    });
  });

  it('saves a legacy target without a slash in the public folder, as before', async () => {
    await POST(bookmarkRequest({ target: 'text-1', content: '一文目' }));

    expect(upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'text-1', directory: 'public' }));
  });

  it.each([
    ['a target that climbs out of the book folders', { target: 'bookv2-furigana/../secret', content: '一文目' }],
    ['a directory with a .. segment', { directory: 'bookv2-furigana/..', fileName: 'secret', content: '一文目' }],
    ['a leading slash', { directory: '/bookv2-furigana/ほん', fileName: 'ほん-rephrase-furigana', content: '一文目' }],
  ])('answers 400 without saving for %s', async (_case, body) => {
    const response = await POST(bookmarkRequest(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(upsertBookmark).not.toHaveBeenCalled();
  });

  it.each([
    ['a directory but no fileName', { directory: BOOK.directory, content: '一文目' }],
    ['a fileName that is not text', { directory: BOOK.directory, fileName: 7, content: '一文目' }],
    ['a directory that is not text', { directory: 7, fileName: BOOK.fileName, content: '一文目' }],
  ])('answers 400 invalid_body without saving for %s', async (_case, body) => {
    const response = await POST(bookmarkRequest(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_body');
    expect(upsertBookmark).not.toHaveBeenCalled();
  });

  it('answers a generic 500 that does not leak the database error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(upsertBookmark).mockRejectedValue(new Error('relation "bookmarks" does not exist'));

    const response = await POST(bookmarkRequest({ target: TARGET, content: '一文目' }));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('bookmarks');
    error.mockRestore();
  });
});
