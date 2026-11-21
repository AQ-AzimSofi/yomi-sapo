import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { getVocabularyEntryById, updateVocabularyEntry } from '@/lib/db/vocabularyQueries.sql';
import type { VocabularyEntry } from '@/lib/types';
import { GET, PUT } from './route';

vi.mock('@/lib/db/vocabularyQueries.sql', () => ({
  getVocabularyEntryById: vi.fn(),
  updateVocabularyEntry: vi.fn(),
  deleteVocabularyEntry: vi.fn(),
}));

const ENTRY: VocabularyEntry = {
  id: 'entry-1',
  word: '言葉',
  reading: null,
  sentence: '言葉を選ぶ。',
  fileName: 'ほん-rephrase-furigana',
  directory: 'bookv2-furigana/ほん',
  paragraphText: null,
  notes: 'メモ',
  createdAt: '2026-01-02T03:04:05.006Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
};

const ENTRY_PARAMS = { params: Promise.resolve({ id: 'entry-1' }) };
const ENTRY_URL = 'http://localhost/api/vocabulary/entry-1';
const OWNER_HEADERS = await ownerSessionHeaders();

function updateRequest(body: unknown): Request {
  return new Request(ENTRY_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...OWNER_HEADERS },
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

describe('GET /api/vocabulary/[id]', () => {
  it('wraps the entry the query returns in a success response', async () => {
    vi.mocked(getVocabularyEntryById).mockResolvedValue(ENTRY);

    const response = await GET(new Request(ENTRY_URL, { headers: OWNER_HEADERS }), ENTRY_PARAMS);

    expect(await response.json()).toStrictEqual({ success: true, entry: ENTRY });
  });

  it('answers 404 for an id that has no entry', async () => {
    vi.mocked(getVocabularyEntryById).mockResolvedValue(null);

    const response = await GET(new Request(ENTRY_URL, { headers: OWNER_HEADERS }), ENTRY_PARAMS);

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/vocabulary/[id]', () => {
  const UPDATE_BODY = { notes: 'メモ', word: '言葉', reading: 'ことば' };

  it('forwards notes, word and reading to the update and returns the updated entry', async () => {
    vi.mocked(updateVocabularyEntry).mockResolvedValue(ENTRY);

    const response = await PUT(updateRequest(UPDATE_BODY), ENTRY_PARAMS);

    expect(updateVocabularyEntry).toHaveBeenCalledWith('entry-1', UPDATE_BODY);
    expect(await response.json()).toStrictEqual({
      success: true,
      message: 'Vocabulary entry updated',
      entry: ENTRY,
    });
  });

  it('answers 400 without updating for notes that are not text', async () => {
    const response = await PUT(updateRequest({ notes: 7 }), ENTRY_PARAMS);

    expect(response.status).toBe(400);
    expect(updateVocabularyEntry).not.toHaveBeenCalled();
  });
});
