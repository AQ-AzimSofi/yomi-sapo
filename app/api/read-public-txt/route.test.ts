import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticated } from '@/lib/auth/apiSession';
import { getTextEntry, getTextEntryVersion } from '@/lib/db/queries';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import { GET } from './route';

vi.mock('@/lib/auth/apiSession', () => ({ isAuthenticated: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ getTextEntry: vi.fn(), getTextEntryVersion: vi.fn() }));

const OWNER_BOOK = { directory: 'bookv2-furigana/ほん', fileName: 'ほん-rephrase-furigana' };
const BOOK_TEXT = '< 一文目\n>> やさしい一文目';

function readRequest(fileName: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/read-public-txt?fileName=${encodeURIComponent(fileName)}`, { headers });
}

function versionFor(location: { file: string; directory: string }): string | null {
  return location.directory === OWNER_BOOK.directory && location.file === OWNER_BOOK.fileName ? '1200-1700000000000' : null;
}

beforeEach(() => {
  vi.mocked(isAuthenticated).mockResolvedValue(true);
  vi.mocked(getTextEntryVersion).mockImplementation(async (file, directory) => versionFor({ file, directory }));
  vi.mocked(getTextEntry).mockResolvedValue(BOOK_TEXT);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/read-public-txt', () => {
  it('returns the book with an ETag and asks the browser to revalidate', async () => {
    const response = await GET(readRequest(`${OWNER_BOOK.directory}/${OWNER_BOOK.fileName}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: BOOK_TEXT });
    expect(response.headers.get('etag')).toBe('"1200-1700000000000-full"');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('answers 304 without reading the text when the browser already has this version', async () => {
    const response = await GET(
      readRequest(`${OWNER_BOOK.directory}/${OWNER_BOOK.fileName}`, { 'if-none-match': '"1200-1700000000000-full"' })
    );

    expect(response.status).toBe(304);
    expect(getTextEntry).not.toHaveBeenCalled();
  });

  it('sends the text again when the stored version changed', async () => {
    const response = await GET(
      readRequest(`${OWNER_BOOK.directory}/${OWNER_BOOK.fileName}`, { 'if-none-match': '"900-1600000000000-full"' })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"1200-1700000000000-full"');
  });

  it('resolves a combined path to the most nested directory first', async () => {
    await GET(readRequest(`${OWNER_BOOK.directory}/${OWNER_BOOK.fileName}`));

    expect(getTextEntryVersion).toHaveBeenNthCalledWith(1, OWNER_BOOK.fileName, OWNER_BOOK.directory);
    expect(getTextEntry).toHaveBeenCalledWith(OWNER_BOOK.fileName, OWNER_BOOK.directory);
  });

  it('returns empty text for a book that does not exist', async () => {
    const response = await GET(readRequest('bookv2-furigana/ない/ない-rephrase'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: '' });
    expect(getTextEntry).not.toHaveBeenCalled();
  });

  it('gives a guest preview its own ETag, separate from the full book', async () => {
    const book = PUBLIC_BOOKS[0];
    vi.mocked(isAuthenticated).mockResolvedValue(false);
    vi.mocked(getTextEntryVersion).mockResolvedValue('5000-1700000000000');

    const response = await GET(readRequest(`${book.directory}/${book.fileName}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"5000-1700000000000-preview${book.maxPreviewPages}"`);
  });

  it('refuses a guest reading a book outside the allowlist without touching the database', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false);

    const response = await GET(readRequest(`${OWNER_BOOK.directory}/${OWNER_BOOK.fileName}`));

    expect(response.status).toBe(403);
    expect(getTextEntryVersion).not.toHaveBeenCalled();
  });

  it('rejects a path that climbs out of the book folders', async () => {
    const response = await GET(readRequest('../secret'));

    expect(response.status).toBe(400);
  });
});
