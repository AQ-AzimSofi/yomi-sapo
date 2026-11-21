import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { sql } from '@/lib/db/connection';
import { createVocabularyEntry } from '@/lib/db/vocabularyQueries.sql';
import type { VocabularyEntry } from '@/lib/types';
import { GET, POST } from './route';

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

const OWNER_HEADERS = await ownerSessionHeaders();
const LIST_URL = 'http://localhost/api/vocabulary';

function createRequest(body: unknown, sessionHeaders: Record<string, string> = OWNER_HEADERS): Request {
  return new Request(LIST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
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

describe('GET /api/vocabulary', () => {
  it('lists the stored snake_case rows as camelCase entries with their count', async () => {
    vi.mocked(sql).mockResolvedValue([ROW] as never);

    const response = await GET(new Request(LIST_URL, { headers: OWNER_HEADERS }));

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ success: true, entries: [ENTRY], count: 1 });
  });

  // The vocabulary page is behind the login redirect, so no guest ever sees this 401.
  it('rejects a guest without reading the database', async () => {
    const response = await GET(new Request(LIST_URL));

    expect(response.status).toBe(401);
    expect(sql).not.toHaveBeenCalled();
  });

  it('keeps the top-level message the vocabulary page shows when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sql).mockRejectedValue(new Error('connection refused') as never);

    const response = await GET(new Request(LIST_URL, { headers: OWNER_HEADERS }));

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      error: { code: 'internal_error', message: 'Failed to fetch vocabulary entries' },
      message: 'Failed to fetch vocabulary entries',
    });
    error.mockRestore();
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

  it('rejects a guest without saving', async () => {
    const response = await POST(createRequest(CREATE_BODY, {}));

    expect(response.status).toBe(401);
    expect(createVocabularyEntry).not.toHaveBeenCalled();
  });

  it('rejects a snake_case body without saving', async () => {
    const { fileName, paragraphText, ...rest } = CREATE_BODY;

    const response = await POST(createRequest({ ...rest, file_name: fileName, paragraph_text: paragraphText }));

    expect(response.status).toBe(400);
    expect(createVocabularyEntry).not.toHaveBeenCalled();
  });
});
