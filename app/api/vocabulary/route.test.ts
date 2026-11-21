import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticated } from '@/lib/auth/apiSession';
import { sql } from '@/lib/db/connection';
import { createVocabularyEntry } from '@/lib/db/vocabularyQueries.sql';
import type { VocabularyEntry } from '@/lib/types';
import { GET, POST } from './route';

vi.mock('@/lib/auth/apiSession', () => ({ isAuthenticated: vi.fn() }));
vi.mock('@/lib/db/connection', () => ({ sql: vi.fn() }));
// GET runs the real query module on the mocked driver, so a snake_case row that reaches the response unmapped fails the list test.
vi.mock('@/lib/db/vocabularyQueries.sql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/vocabularyQueries.sql')>()),
  createVocabularyEntry: vi.fn(),
}));

const ROW = {
  id: 'entry-1',
  word: '言葉',
  reading: 'ことば',
  sentence: '言葉を選ぶ。',
  file_name: 'ほん-rephrase-furigana',
  directory: 'bookv2-furigana/ほん',
  paragraph_text: '言葉を選ぶ。それから話す。',
  notes: null,
  created_at: new Date('2026-01-02T03:04:05.006Z'),
  updated_at: new Date('2026-01-02T03:04:05.006Z'),
};

const ENTRY: VocabularyEntry = {
  id: 'entry-1',
  word: '言葉',
  reading: 'ことば',
  sentence: '言葉を選ぶ。',
  fileName: 'ほん-rephrase-furigana',
  directory: 'bookv2-furigana/ほん',
  paragraphText: '言葉を選ぶ。それから話す。',
  notes: null,
  createdAt: '2026-01-02T03:04:05.006Z',
  updatedAt: '2026-01-02T03:04:05.006Z',
};

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/vocabulary', {
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

describe('GET /api/vocabulary', () => {
  it('lists the stored snake_case rows as camelCase entries with their count', async () => {
    vi.mocked(sql).mockResolvedValue([ROW] as never);

    const response = await GET(new Request('http://localhost/api/vocabulary'));

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ success: true, entries: [ENTRY], count: 1 });
  });

  it('gives a guest an empty list without reading the database', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false);

    const response = await GET(new Request('http://localhost/api/vocabulary'));

    expect(await response.json()).toStrictEqual({ success: true, entries: [], count: 0 });
    expect(sql).not.toHaveBeenCalled();
  });
});

describe('POST /api/vocabulary', () => {
  const CREATE_BODY = {
    word: ENTRY.word,
    reading: ENTRY.reading,
    sentence: ENTRY.sentence,
    fileName: ENTRY.fileName,
    directory: ENTRY.directory,
    paragraphText: ENTRY.paragraphText,
    notes: 'メモ',
  };

  it('saves the camelCase body and returns the created entry', async () => {
    vi.mocked(createVocabularyEntry).mockResolvedValue(ENTRY);

    const response = await POST(createRequest(CREATE_BODY));

    expect(createVocabularyEntry).toHaveBeenCalledWith(CREATE_BODY);
    expect(await response.json()).toStrictEqual({
      success: true,
      message: 'Vocabulary entry created',
      entry: ENTRY,
    });
  });

  it('rejects a snake_case body without saving', async () => {
    const { fileName, paragraphText, ...rest } = CREATE_BODY;

    const response = await POST(createRequest({ ...rest, file_name: fileName, paragraph_text: paragraphText }));

    expect(response.status).toBe(400);
    expect(createVocabularyEntry).not.toHaveBeenCalled();
  });
});
