import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { getLibraryRows, type LibraryRow } from '@/lib/db/libraryProgressQueries.sql';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import { GET } from './route';

vi.mock('@/lib/db/libraryProgressQueries.sql', () => ({ getLibraryRows: vi.fn() }));

const OWNER_HEADERS = await ownerSessionHeaders();
const PROGRESS_URL = 'http://localhost/api/library-progress';
const PREVIEW_BOOK = PUBLIC_BOOKS[0];

const PREVIEW_ROW: LibraryRow = {
  id: 1,
  file_name: PREVIEW_BOOK.fileName,
  directory: PREVIEW_BOOK.directory,
  created_at: '2026-01-02T03:04:05.006Z',
  total_pages: 40,
  total_characters: 90000,
  content_bytes: 270000,
  current_bytes: 270000,
  bookmark_text: '一文目',
  bookmark_page: 10,
  bookmark_updated_at: '2026-01-03T00:00:00.000Z',
};

const OWNER_ROW: LibraryRow = { ...PREVIEW_ROW, id: 2, file_name: 'ほん-rephrase-furigana', directory: 'bookv2-furigana/ほん' };

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  // Applies the route's visibility filter, as the real query does.
  vi.mocked(getLibraryRows).mockImplementation(async (isVisible) => [PREVIEW_ROW, OWNER_ROW].filter(isVisible));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/library-progress', () => {
  it("shows a guest only the preview books, capped to the preview and without the owner's position", async () => {
    const response = await GET(new Request(PROGRESS_URL));

    expect(await response.json()).toStrictEqual({
      [`${PREVIEW_BOOK.directory}/${PREVIEW_BOOK.fileName}`]: {
        progress: 0,
        totalCharacters: 0,
        bookmarkPage: null,
        totalPages: PREVIEW_BOOK.maxPreviewPages,
        bookmarkUpdatedAt: null,
        createdAt: PREVIEW_ROW.created_at,
      },
    });
  });

  it('shows the signed-in owner every book with the saved position', async () => {
    const response = await GET(new Request(PROGRESS_URL, { headers: OWNER_HEADERS }));
    const progress = await response.json();

    expect(Object.keys(progress)).toHaveLength(2);
    expect(progress[`${OWNER_ROW.directory}/${OWNER_ROW.file_name}`]).toMatchObject({ bookmarkPage: 10, totalPages: 40 });
  });
});
