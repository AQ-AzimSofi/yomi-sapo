import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticated } from '@/lib/auth/apiSession';
import { sql } from '@/lib/db/connection';
import {
  deleteVocabularyEntry,
  getVocabularyEntryById,
  updateVocabularyEntry,
} from '@/lib/db/vocabularyQueries.sql';
import { upsertTextEntry } from '@/lib/db/queries';
import { readTextFile } from '@/lib/services/fileService';
import { GET as initDb } from './init-db/route';
import {
  DELETE as deleteVocabulary,
  GET as getVocabulary,
  PUT as putVocabulary,
} from './vocabulary/[id]/route';
import { PUT as putTextEntry } from './text-entries/route';

vi.mock('@/lib/auth/apiSession', () => ({ isAuthenticated: vi.fn() }));
vi.mock('@/lib/db/connection', () => ({ sql: { unsafe: vi.fn() } }));
vi.mock('@/lib/db/vocabularyQueries.sql', () => ({
  getVocabularyEntryById: vi.fn(),
  updateVocabularyEntry: vi.fn(),
  deleteVocabularyEntry: vi.fn(),
}));
vi.mock('@/lib/db/queries', () => ({
  getTextEntry: vi.fn(),
  getAllTextEntries: vi.fn(),
  deleteTextEntry: vi.fn(),
  upsertTextEntry: vi.fn(),
}));
vi.mock('@/lib/services/fileService', () => ({ readTextFile: vi.fn() }));

const ENTRY_PARAMS = { params: Promise.resolve({ id: 'entry-1' }) };

function jsonRequest(method: string, body: unknown): Request {
  return new Request('http://localhost/api/test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(isAuthenticated).mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/init-db', () => {
  it('rejects a guest in production without touching the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await initDb();

    expect(response.status).toBe(401);
    expect(sql.unsafe).not.toHaveBeenCalled();
  });

  it('runs the schema SQL for a signed-in owner in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(isAuthenticated).mockResolvedValue(true);

    const response = await initDb();

    expect(response.status).toBe(200);
    expect(sql.unsafe).toHaveBeenCalledTimes(2);
  });

  it('runs the schema SQL without a session on the local dev server', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await initDb();

    expect(response.status).toBe(200);
    expect(sql.unsafe).toHaveBeenCalledTimes(2);
  });
});

describe('/api/vocabulary/[id]', () => {
  it('rejects a guest reading an entry', async () => {
    const response = await getVocabulary(new Request('http://localhost/api/vocabulary/entry-1'), ENTRY_PARAMS);

    expect(response.status).toBe(401);
    expect(getVocabularyEntryById).not.toHaveBeenCalled();
  });

  it('rejects a guest updating an entry', async () => {
    const response = await putVocabulary(jsonRequest('PUT', { notes: 'x' }), ENTRY_PARAMS);

    expect(response.status).toBe(401);
    expect(updateVocabularyEntry).not.toHaveBeenCalled();
  });

  it('rejects a guest deleting an entry', async () => {
    const response = await deleteVocabulary(new Request('http://localhost/api/vocabulary/entry-1', { method: 'DELETE' }), ENTRY_PARAMS);

    expect(response.status).toBe(401);
    expect(deleteVocabularyEntry).not.toHaveBeenCalled();
  });

  it('returns the entry to a signed-in owner', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true);
    vi.mocked(getVocabularyEntryById).mockResolvedValue({ id: 'entry-1', word: '言葉' } as never);

    const response = await getVocabulary(new Request('http://localhost/api/vocabulary/entry-1'), ENTRY_PARAMS);

    expect(response.status).toBe(200);
    expect(getVocabularyEntryById).toHaveBeenCalledWith('entry-1');
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

  it('copies a book file into the database on the local dev server', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.mocked(readTextFile).mockResolvedValue('< 本文\n>> やさしい文');

    const response = await putTextEntry(jsonRequest('PUT', BOOK));

    expect(response.status).toBe(200);
    expect(upsertTextEntry).toHaveBeenCalledWith(BOOK.fileName, '< 本文\n>> やさしい文', BOOK.directory);
  });
});
