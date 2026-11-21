import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeBookmarksForFiles, upsertBookmark, upsertTextEntry } from '@/lib/db/queries';
import { BookTextTooLargeError } from '@/lib/db/bookTextSize';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { POST } from './route';

vi.mock('@/lib/db/queries', () => ({
  upsertTextEntry: vi.fn(),
  upsertBookmark: vi.fn(),
  initializeBookmarksForFiles: vi.fn(),
  backfillTextMetadata: vi.fn(),
}));

const ADMIN_API_KEY = 'admin-key-0123';
const ADMIN_HEADERS = { 'x-api-key': ADMIN_API_KEY };
const OWNER_HEADERS = await ownerSessionHeaders();

function adminRequest(action: string, body: unknown, headers: Record<string, string> = ADMIN_HEADERS): Request {
  return new Request(`http://localhost/api/admin?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('ADMIN_API_KEY', ADMIN_API_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/admin', () => {
  const UPLOAD = { fileName: 'ほん', directory: 'bookv2-furigana/ほん', content: '本文' };

  it('rejects a signed-in owner who sends no API key', async () => {
    const response = await POST(adminRequest('text-entries', UPLOAD, OWNER_HEADERS));

    expect(response.status).toBe(401);
    expect(upsertTextEntry).not.toHaveBeenCalled();
  });

  it('uploads a text entry with the API key, as the book pipeline does', async () => {
    const response = await POST(adminRequest('text-entries', UPLOAD));

    expect(await response.json()).toStrictEqual({
      success: true,
      message: 'Text entry for bookv2-furigana/ほん/ほん created/updated successfully',
      stats: { fileName: 'ほん', directory: 'bookv2-furigana/ほん', contentLength: 2 },
    });
    expect(initializeBookmarksForFiles).toHaveBeenCalledWith(['ほん'], 'bookv2-furigana/ほん');
  });

  it('answers 413 naming the book when its text is too large to store, and adds no bookmark', async () => {
    const tooLarge = new BookTextTooLargeError(1_100_000);
    vi.mocked(upsertTextEntry).mockRejectedValueOnce(tooLarge);

    const response = await POST(adminRequest('text-entries', UPLOAD));

    expect(response.status).toBe(413);
    expect(await response.json()).toStrictEqual({
      error: { code: 'text_too_large', message: `bookv2-furigana/ほん/ほん: ${tooLarge.message}` },
    });
    expect(initializeBookmarksForFiles).not.toHaveBeenCalled();
  });

  it('reports a bulk entry too large to store with the size it would need', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tooLarge = new BookTextTooLargeError(1_100_000);
    vi.mocked(upsertTextEntry).mockRejectedValueOnce(tooLarge);

    const response = await POST(adminRequest('bulk-seed', { entries: [UPLOAD] }));

    expect((await response.json()).results).toStrictEqual([
      { fileName: 'ほん', directory: 'bookv2-furigana/ほん', success: false, error: tooLarge.message },
    ]);
    expect(initializeBookmarksForFiles).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers 400 without saving a text entry that has no content', async () => {
    const response = await POST(adminRequest('text-entries', { fileName: 'ほん' }));

    expect(response.status).toBe(400);
    expect(upsertTextEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['bookmarks', { fileName: 'ほん', bookmarkText: 5 }],
    ['bulk-seed', { entries: [] }],
  ])('answers 400 without saving a bad %s body', async (action, body) => {
    const response = await POST(adminRequest(action, body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_body');
    expect(upsertBookmark).not.toHaveBeenCalled();
    expect(upsertTextEntry).not.toHaveBeenCalled();
  });

  it('reports each bulk entry, without the database error text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(upsertTextEntry).mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

    const response = await POST(adminRequest('bulk-seed', { entries: [UPLOAD, null, { fileName: 'b' }] }));

    expect(await response.json()).toStrictEqual({
      success: false,
      message: 'Bulk upload completed: 0 succeeded, 3 failed',
      stats: { total: 3, succeeded: 0, failed: 3 },
      results: [
        { fileName: 'ほん', directory: 'bookv2-furigana/ほん', success: false, error: 'Failed to save this entry' },
        { fileName: 'unknown', directory: 'bookv2-furigana', success: false, error: 'fileName is required and must be a string' },
        { fileName: 'b', directory: 'bookv2-furigana', success: false, error: 'content is required and must be a string' },
      ],
    });
    error.mockRestore();
  });
});
