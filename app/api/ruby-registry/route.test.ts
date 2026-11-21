import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { deleteRubyEntry, readRubyRegistry, upsertRubyEntry } from '@/lib/services/fileService';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import type { RubyRegistry } from '@/lib/types';
import { DELETE, GET, POST } from './route';

vi.mock('@/lib/services/fileService', () => ({
  readRubyRegistry: vi.fn(),
  upsertRubyEntry: vi.fn(),
  deleteRubyEntry: vi.fn(),
  ignoreSuggestion: vi.fn(),
}));

const OWNER_HEADERS = await ownerSessionHeaders();
const REGISTRY: RubyRegistry = { bookTitle: 'ほん', entries: [], suggestions: [] };
const [PREVIEW_PARENT, PREVIEW_BOOK_NAME] = splitLast(PUBLIC_BOOKS[0].directory);

function splitLast(path: string): [string, string] {
  const slash = path.lastIndexOf('/');
  return [path.slice(0, slash), path.slice(slash + 1)];
}

function registryRequest(directory: string, bookName: string, headers: Record<string, string> = {}): Request {
  const query = new URLSearchParams({ directory, bookName });
  return new Request(`http://localhost/api/ruby-registry?${query}`, { headers });
}

function saveRequest(body: unknown, headers: Record<string, string> = OWNER_HEADERS): Request {
  return new Request('http://localhost/api/ruby-registry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.mocked(readRubyRegistry).mockResolvedValue(REGISTRY);
  vi.mocked(upsertRubyEntry).mockResolvedValue(REGISTRY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/ruby-registry', () => {
  it('refuses a guest the registry of a book outside the preview without reading it', async () => {
    const response = await GET(registryRequest('bookv2-furigana', 'ほん'));

    expect(response.status).toBe(403);
    expect(readRubyRegistry).not.toHaveBeenCalled();
  });

  it('gives a guest the registry of a preview book', async () => {
    const response = await GET(registryRequest(PREVIEW_PARENT, PREVIEW_BOOK_NAME));

    expect(await response.json()).toStrictEqual({ success: true, registry: REGISTRY, message: 'Registry loaded' });
  });

  it('gives the signed-in owner the registry of any book', async () => {
    const response = await GET(registryRequest('bookv2-furigana', 'ほん', OWNER_HEADERS));

    expect(response.status).toBe(200);
    expect(readRubyRegistry).toHaveBeenCalledWith('bookv2-furigana', 'ほん');
  });

  it.each([
    ['a .. book name', 'bookv2-furigana', '..'],
    ['a leading slash', '/bookv2-furigana', 'ほん'],
    ['a backslash, which Windows reads as a separator', 'bookv2-furigana', 'ほん\\secret'],
  ])('answers 400 without reading for %s', async (_case, directory, bookName) => {
    const response = await GET(registryRequest(directory, bookName, OWNER_HEADERS));

    expect(response.status).toBe(400);
    expect(readRubyRegistry).not.toHaveBeenCalled();
  });
});

describe('POST /api/ruby-registry', () => {
  const ENTRY = { kanji: '本', reading: 'ほん', note: '' };

  it('rejects a guest without saving', async () => {
    const response = await POST(saveRequest({ directory: 'bookv2-furigana', bookName: 'ほん', entry: ENTRY }, {}));

    expect(response.status).toBe(401);
    expect(upsertRubyEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['no reading', { kanji: '本' }],
    ['an unknown source', { ...ENTRY, source: 'admin' }],
  ])('answers 400 without saving for an entry with %s', async (_case, entry) => {
    const response = await POST(saveRequest({ directory: 'bookv2-furigana', bookName: 'ほん', entry }));

    expect(response.status).toBe(400);
    expect(upsertRubyEntry).not.toHaveBeenCalled();
  });

  it('answers 400 without saving for a book outside the book folders', async () => {
    const response = await POST(saveRequest({ directory: 'bookv2-furigana/..', bookName: '..', entry: ENTRY }));

    expect(response.status).toBe(400);
    expect(upsertRubyEntry).not.toHaveBeenCalled();
  });

  it("saves only the entry fields, marked as the reader's own", async () => {
    await POST(saveRequest({ directory: 'bookv2-furigana', bookName: 'ほん', entry: { ...ENTRY, extra: 'x' } }));

    expect(upsertRubyEntry).toHaveBeenCalledWith('bookv2-furigana', 'ほん', {
      kanji: '本',
      reading: 'ほん',
      source: 'user',
      note: '',
    });
  });
});

describe('DELETE /api/ruby-registry', () => {
  it('rejects a guest without deleting', async () => {
    const query = new URLSearchParams({ directory: 'bookv2-furigana', bookName: 'ほん', kanji: '本' });

    const response = await DELETE(new Request(`http://localhost/api/ruby-registry?${query}`, { method: 'DELETE' }));

    expect(response.status).toBe(401);
    expect(deleteRubyEntry).not.toHaveBeenCalled();
  });

  it('answers 400 without deleting for a book outside the book folders', async () => {
    const query = new URLSearchParams({ directory: 'bookv2-furigana/..', bookName: '..', kanji: '本' });

    const response = await DELETE(new Request(`http://localhost/api/ruby-registry?${query}`, { method: 'DELETE', headers: OWNER_HEADERS }));

    expect(response.status).toBe(400);
    expect(deleteRubyEntry).not.toHaveBeenCalled();
  });
});
