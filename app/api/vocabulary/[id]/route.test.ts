import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticated } from '@/lib/auth/apiSession';
import { getVocabularyEntryById, updateVocabularyEntry } from '@/lib/db/vocabularyQueries.sql';
import type { VocabularyEntry } from '@/lib/types';
import { GET, PUT } from './route';

vi.mock('@/lib/auth/apiSession', () => ({ isAuthenticated: vi.fn() }));
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

beforeEach(() => {
  vi.mocked(isAuthenticated).mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/vocabulary/[id]', () => {
  it('returns the entry in the camelCase shape', async () => {
    vi.mocked(getVocabularyEntryById).mockResolvedValue(ENTRY);

    const response = await GET(new Request('http://localhost/api/vocabulary/entry-1'), ENTRY_PARAMS);

    expect(await response.json()).toStrictEqual({ success: true, entry: ENTRY });
  });

  it('answers 404 for an id that has no entry', async () => {
    vi.mocked(getVocabularyEntryById).mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/vocabulary/entry-1'), ENTRY_PARAMS);

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/vocabulary/[id]', () => {
  it('returns the updated entry in the camelCase shape', async () => {
    vi.mocked(updateVocabularyEntry).mockResolvedValue(ENTRY);

    const response = await PUT(
      new Request('http://localhost/api/vocabulary/entry-1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: 'メモ' }),
      }),
      ENTRY_PARAMS
    );

    expect(await response.json()).toStrictEqual({
      success: true,
      message: 'Vocabulary entry updated',
      entry: ENTRY,
    });
  });
});
