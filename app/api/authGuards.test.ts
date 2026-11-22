import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { sql } from '@/lib/db/connection';
import { applySchema } from '@/lib/db/schemaRunner';
import {
  deleteVocabularyEntry,
  getVocabularyEntryById,
  updateVocabularyEntry,
} from '@/lib/db/vocabularyQueries.sql';
import { getBookmark, upsertTextEntry } from '@/lib/db/queries';
import { BookTextTooLargeError } from '@/lib/db/bookTextSize';
import { getNarration } from '@/lib/db/narrationQueries.sql';
import { readTextFile } from '@/lib/services/fileService';
import { GET as initDb } from './init-db/route';
import { GET as readBookmark } from './read-bookmark/route';
import { GET as getNarrationManifest } from './narration/route';
import {
  DELETE as deleteVocabulary,
  GET as getVocabulary,
  PUT as putVocabulary,
} from './vocabulary/[id]/route';
import { PUT as putTextEntry } from './text-entries/route';

vi.mock('@/lib/db/connection', () => ({ sql: { unsafe: vi.fn() }, databaseKind: 'postgres' }));
vi.mock('@/lib/db/schemaRunner', () => ({ applySchema: vi.fn() }));
vi.mock('@/lib/db/vocabularyQueries.sql', () => ({
  getVocabularyEntryById: vi.fn(),
  updateVocabularyEntry: vi.fn(),
  deleteVocabularyEntry: vi.fn(),
}));
vi.mock('@/lib/db/queries', () => ({ upsertTextEntry: vi.fn(), getBookmark: vi.fn() }));
vi.mock('@/lib/db/narrationQueries.sql', () => ({ getNarration: vi.fn() }));
vi.mock('@/lib/services/fileService', () => ({ readTextFile: vi.fn() }));

const ENTRY_PARAMS = { params: Promise.resolve({ id: 'entry-1' }) };
const OWNER_HEADERS = await ownerSessionHeaders();
const ENTRY_URL = 'http://localhost/api/vocabulary/entry-1';

function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function initDbRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/init-db', { headers });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/init-db', () => {
  it('rejects a guest in production without touching the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await initDb(initDbRequest());

    expect(response.status).toBe(401);
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('runs the schema SQL for a signed-in owner in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await initDb(initDbRequest(OWNER_HEADERS));

    expect(response.status).toBe(200);
    expect(applySchema).toHaveBeenCalledWith(sql, 'postgres');
  });

  it.each(['test', 'staging'])('rejects a guest when NODE_ENV is %s', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);

    const response = await initDb(initDbRequest());

    expect(response.status).toBe(401);
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('runs the schema SQL without a session on the local dev server', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await initDb(initDbRequest());

    expect(response.status).toBe(200);
    expect(applySchema).toHaveBeenCalledWith(sql, 'postgres');
  });
});

describe('GET /api/read-bookmark', () => {
  const BOOKMARK_URL = 'http://localhost/api/read-bookmark?fileName=bookv2-furigana%2F%E3%81%BB%E3%82%93%2F%E3%81%BB%E3%82%93';

  // The reader and the library treat a failed response as "no bookmark", as they did the old empty 200.
  it("rejects a guest without reading the owner's bookmark", async () => {
    const response = await readBookmark(new Request(BOOKMARK_URL));

    expect(response.status).toBe(401);
    expect(getBookmark).not.toHaveBeenCalled();
  });

  it('returns the saved bookmark to a signed-in owner', async () => {
    vi.mocked(getBookmark).mockResolvedValue({ text: '一文目', page: 3 });

    const response = await readBookmark(new Request(BOOKMARK_URL, { headers: OWNER_HEADERS }));

    expect(await response.json()).toStrictEqual({ text: '一文目', page: 3 });
    expect(getBookmark).toHaveBeenCalledWith('ほん', 'bookv2-furigana/ほん');
  });
});

describe('GET /api/narration', () => {
  const NARRATION_URL = 'http://localhost/api/narration?directory=bookv2-furigana%2F%E3%81%BB%E3%82%93&fileName=x';

  // useNarration treats 401 as a guest, who is never served a recording, and shows no error.
  it('answers a guest 401 without looking up the recording', async () => {
    const response = await getNarrationManifest(new Request(NARRATION_URL));

    expect(response.status).toBe(401);
    expect(getNarration).not.toHaveBeenCalled();
  });

  // useNarration also stays silent on 404; any other failure shows the owner an error.
  it('answers the owner 404 for a text with no recording', async () => {
    vi.stubEnv('NARRATION_AUDIO_BUCKET', 'narration-audio');
    vi.mocked(getNarration).mockResolvedValue(null);

    const response = await getNarrationManifest(new Request(NARRATION_URL, { headers: OWNER_HEADERS }));

    expect(response.status).toBe(404);
    expect(getNarration).toHaveBeenCalledWith('x', 'bookv2-furigana/ほん');
  });
});

describe('/api/vocabulary/[id]', () => {
  it('rejects a guest reading an entry', async () => {
    const response = await getVocabulary(new Request(ENTRY_URL), ENTRY_PARAMS);

    expect(response.status).toBe(401);
    expect(getVocabularyEntryById).not.toHaveBeenCalled();
  });

  it('rejects a guest updating an entry', async () => {
    const response = await putVocabulary(jsonRequest('PUT', { notes: 'x' }), ENTRY_PARAMS);

    expect(response.status).toBe(401);
    expect(updateVocabularyEntry).not.toHaveBeenCalled();
  });

  it('rejects a guest deleting an entry', async () => {
    const response = await deleteVocabulary(new Request(ENTRY_URL, { method: 'DELETE' }), ENTRY_PARAMS);

    expect(response.status).toBe(401);
    expect(deleteVocabularyEntry).not.toHaveBeenCalled();
  });

  it('returns the entry to a signed-in owner', async () => {
    vi.mocked(getVocabularyEntryById).mockResolvedValue({ id: 'entry-1', word: '言葉' } as never);

    const response = await getVocabulary(new Request(ENTRY_URL, { headers: OWNER_HEADERS }), ENTRY_PARAMS);

    expect(response.status).toBe(200);
    expect(getVocabularyEntryById).toHaveBeenCalledWith('entry-1');
  });

  it('updates an entry for a signed-in owner', async () => {
    vi.mocked(updateVocabularyEntry).mockResolvedValue({ id: 'entry-1', word: '言葉' } as never);

    const response = await putVocabulary(jsonRequest('PUT', { notes: 'x' }, OWNER_HEADERS), ENTRY_PARAMS);

    expect(response.status).toBe(200);
    expect(updateVocabularyEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining({ notes: 'x' }));
  });

  it('deletes an entry for a signed-in owner', async () => {
    const response = await deleteVocabulary(new Request(ENTRY_URL, { method: 'DELETE', headers: OWNER_HEADERS }), ENTRY_PARAMS);

    expect(response.status).toBe(200);
    expect(deleteVocabularyEntry).toHaveBeenCalledWith('entry-1');
  });
});

describe('PUT /api/text-entries', () => {
  const BOOK = { fileName: 'ほん-rephrase-furigana', directory: 'bookv2-furigana/ほん' };

  it('is not available outside the local dev server', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await putTextEntry(jsonRequest('PUT', BOOK));

    expect(response.status).toBe(404);
    expect(readTextFile).not.toHaveBeenCalled();
    expect(upsertTextEntry).not.toHaveBeenCalled();
  });

  it.each(['production', 'test'])('is not available to a signed-in owner when NODE_ENV is %s', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);

    const response = await putTextEntry(jsonRequest('PUT', BOOK, OWNER_HEADERS));

    expect(response.status).toBe(404);
    expect(readTextFile).not.toHaveBeenCalled();
    expect(upsertTextEntry).not.toHaveBeenCalled();
  });

  it('answers 400 without reading a file when the directory is not a string', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await putTextEntry(jsonRequest('PUT', { fileName: BOOK.fileName, directory: 5 }));

    expect(response.status).toBe(400);
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it.each([
    ['a directory with a .. segment', { fileName: BOOK.fileName, directory: 'bookv2-furigana/..' }],
    ['a leading slash', { fileName: BOOK.fileName, directory: `/${BOOK.directory}` }],
    ['a backslash, which Windows reads as a separator', { fileName: 'ほん\\secret', directory: BOOK.directory }],
  ])('answers 400 without reading a file for %s', async (_case, book) => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await putTextEntry(jsonRequest('PUT', book));

    expect(response.status).toBe(400);
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('copies a book file into the database on the local dev server', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(readTextFile).mockResolvedValue('< 本文\n>> やさしい文');

    const response = await putTextEntry(jsonRequest('PUT', BOOK));

    expect(response.status).toBe(200);
    expect(readTextFile).toHaveBeenCalledWith('bookv2-furigana/ほん/ほん-rephrase-furigana');
    expect(upsertTextEntry).toHaveBeenCalledWith(BOOK.fileName, '< 本文\n>> やさしい文', BOOK.directory);
  });

  it('answers 413 naming the book when its text is too large to store', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(readTextFile).mockResolvedValue('< 本文');
    const tooLarge = new BookTextTooLargeError(1_100_000);
    vi.mocked(upsertTextEntry).mockRejectedValue(tooLarge);

    const response = await putTextEntry(jsonRequest('PUT', BOOK));

    expect(response.status).toBe(413);
    expect(await response.json()).toStrictEqual({
      error: { code: 'text_too_large', message: `bookv2-furigana/ほん/ほん-rephrase-furigana: ${tooLarge.message}` },
    });
  });
});
