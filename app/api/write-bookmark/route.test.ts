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
  it('saves the bookmark with the reader page it sits on', async () => {
    const response = await POST(bookmarkRequest({ target: TARGET, content: '一文目', page: 7 }));

    expect(response.status).toBe(200);
    expect(upsertBookmark).toHaveBeenCalledWith({
      fileName: 'ほん-rephrase-furigana',
      directory: 'bookv2-furigana/ほん',
      bookmarkText: '一文目',
      bookmarkPage: 7,
    });
  });

  it.each([0, -2, 2.5, '3', null])('drops an invalid page (%s) so the library recounts it', async (page) => {
    await POST(bookmarkRequest({ target: TARGET, content: '一文目', page }));

    expect(upsertBookmark).toHaveBeenCalledWith(expect.objectContaining({ bookmarkPage: undefined }));
  });

  it('rejects a guest without saving', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false);

    const response = await POST(bookmarkRequest({ target: TARGET, content: '一文目', page: 7 }));

    expect(response.status).toBe(401);
    expect(upsertBookmark).not.toHaveBeenCalled();
  });
});
