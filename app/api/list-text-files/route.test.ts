import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { getAllTextEntries } from '@/lib/db/queries';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import { GET } from './route';

vi.mock('@/lib/db/queries', () => ({ getAllTextEntries: vi.fn() }));

const OWNER_HEADERS = await ownerSessionHeaders();
const LIST_URL = 'http://localhost/api/list-text-files';
const PREVIEW_BOOK = PUBLIC_BOOKS[0];
const OWNER_BOOK = { directory: 'bookv2-furigana/ほん', fileName: 'ほん-rephrase-furigana' };

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.mocked(getAllTextEntries).mockResolvedValue({
    directories: [PREVIEW_BOOK.directory, OWNER_BOOK.directory],
    filesByDirectory: {
      [PREVIEW_BOOK.directory]: [PREVIEW_BOOK.fileName],
      [OWNER_BOOK.directory]: [OWNER_BOOK.fileName],
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/list-text-files', () => {
  it('lists only the preview books for a guest', async () => {
    const response = await GET(new Request(LIST_URL));

    expect(await response.json()).toStrictEqual({
      directories: [PREVIEW_BOOK.directory],
      filesByDirectory: { [PREVIEW_BOOK.directory]: [PREVIEW_BOOK.fileName] },
      files: [`${PREVIEW_BOOK.directory}/${PREVIEW_BOOK.fileName}`],
    });
  });

  it('lists every book for the signed-in owner', async () => {
    const response = await GET(new Request(LIST_URL, { headers: OWNER_HEADERS }));

    expect((await response.json()).files).toStrictEqual([
      `${PREVIEW_BOOK.directory}/${PREVIEW_BOOK.fileName}`,
      `${OWNER_BOOK.directory}/${OWNER_BOOK.fileName}`,
    ]);
  });
});
