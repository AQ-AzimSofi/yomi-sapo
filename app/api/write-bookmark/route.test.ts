import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticated } from '@/lib/auth/apiSession';
import { upsertBookmark } from '@/lib/db/queries';
import { POST } from './route';

vi.mock('@/lib/auth/apiSession', () => ({ isAuthenticated: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ upsertBookmark: vi.fn() }));

const TARGET = 'bookv2-furigana/ほん/ほん-rephrase-furigana';

function bookmarkRequest(body: unknown): Request {
  return new Request('http://localhost/api/write-bookmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(isAuthenticated).mockResolvedValue(true);
});

afterEach(() => {
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
    expect(warn).toHaveBeenCalledWith('Ignoring an invalid bookmark page:', { target: TARGET, page });
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
    vi.mocked(isAuthenticated).mockResolvedValue(false);

    const response = await POST(bookmarkRequest({ target: TARGET, content: '一文目', page: 7 }));

    expect(response.status).toBe(401);
    expect(upsertBookmark).not.toHaveBeenCalled();
  });
});
