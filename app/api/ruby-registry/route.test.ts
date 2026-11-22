import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { getRubyRegistry, hideRubyRegistryItem, saveRubyRegistryEntry } from '@/lib/db/rubyRegistryQueries.sql';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import type { RubyRegistry } from '@/lib/types';
import { DELETE, GET, POST } from './route';

vi.mock('@/lib/db/rubyRegistryQueries.sql', () => ({
  getRubyRegistry: vi.fn(),
  saveRubyRegistryEntry: vi.fn(),
  hideRubyRegistryItem: vi.fn(),
}));

const OWNER_HEADERS = await ownerSessionHeaders();
const KEY = { directory: 'bookv2-furigana', bookName: 'ほん' };
const REGISTRY: RubyRegistry = { bookTitle: 'ほん', entries: [], suggestions: [] };
const [PREVIEW_PARENT, PREVIEW_BOOK_NAME] = splitLast(PUBLIC_BOOKS[0].directory);
// What postgres.js throws on Neon, which has no ruby_registry_entries table until the move to DSQL.
const NO_REGISTRY_TABLE = Object.assign(new Error('relation "ruby_registry_entries" does not exist'), { code: '42P01' });
const UNAVAILABLE_BODY = {
  error: { code: 'registry_unavailable', message: 'The ruby registry is not available on this server yet' },
};

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

function deleteRequest(query: Record<string, string>, headers: Record<string, string> = OWNER_HEADERS): Request {
  return new Request(`http://localhost/api/ruby-registry?${new URLSearchParams(query)}`, { method: 'DELETE', headers });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.mocked(getRubyRegistry).mockResolvedValue(REGISTRY);
  vi.mocked(saveRubyRegistryEntry).mockResolvedValue();
  vi.mocked(hideRubyRegistryItem).mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/ruby-registry', () => {
  it('refuses a guest the registry of a book outside the preview without reading it', async () => {
    const response = await GET(registryRequest('bookv2-furigana', 'ほん'));

    expect(response.status).toBe(403);
    expect(getRubyRegistry).not.toHaveBeenCalled();
  });

  it('gives a guest the registry of a preview book', async () => {
    const response = await GET(registryRequest(PREVIEW_PARENT, PREVIEW_BOOK_NAME));

    expect(await response.json()).toStrictEqual({ success: true, registry: REGISTRY, message: 'Registry loaded' });
  });

  it('gives the signed-in owner the registry of any book, read from the database', async () => {
    const response = await GET(registryRequest('bookv2-furigana', 'ほん', OWNER_HEADERS));

    expect(response.status).toBe(200);
    expect(getRubyRegistry).toHaveBeenCalledWith(KEY);
  });

  it.each([
    ['a .. book name', 'bookv2-furigana', '..'],
    ['a leading slash', '/bookv2-furigana', 'ほん'],
    ['a backslash, which Windows reads as a separator', 'bookv2-furigana', 'ほん\\secret'],
  ])('answers 400 without reading for %s', async (_case, directory, bookName) => {
    const response = await GET(registryRequest(directory, bookName, OWNER_HEADERS));

    expect(response.status).toBe(400);
    expect(getRubyRegistry).not.toHaveBeenCalled();
  });
});

describe('POST /api/ruby-registry', () => {
  const ENTRY = { kanji: '本', reading: 'ほん', note: '' };

  it('rejects a guest without saving', async () => {
    const response = await POST(saveRequest({ ...KEY, entry: ENTRY }, {}));

    expect(response.status).toBe(401);
    expect(saveRubyRegistryEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['no reading', { kanji: '本' }],
    ['an unknown source', { ...ENTRY, source: 'admin' }],
  ])('answers 400 without saving for an entry with %s', async (_case, entry) => {
    const response = await POST(saveRequest({ ...KEY, entry }));

    expect(response.status).toBe(400);
    expect(saveRubyRegistryEntry).not.toHaveBeenCalled();
  });

  it('answers 400 without saving for a book outside the book folders', async () => {
    const response = await POST(saveRequest({ directory: 'bookv2-furigana/..', bookName: '..', entry: ENTRY }));

    expect(response.status).toBe(400);
    expect(saveRubyRegistryEntry).not.toHaveBeenCalled();
  });

  it('keeps the source of an entry extracted from the EPUB, as the edit page sends it back', async () => {
    const response = await POST(saveRequest({ ...KEY, entry: { ...ENTRY, source: 'epub_smart' } }));

    expect(response.status).toBe(200);
    expect(saveRubyRegistryEntry).toHaveBeenCalledWith(KEY, { ...ENTRY, source: 'epub_smart' });
  });

  it("saves only the entry fields, marked as the reader's own", async () => {
    await POST(saveRequest({ ...KEY, entry: { ...ENTRY, extra: 'x' } }));

    expect(saveRubyRegistryEntry).toHaveBeenCalledWith(KEY, { kanji: '本', reading: 'ほん', source: 'user', note: '' });
  });

  it('answers the registry as read after the save', async () => {
    const response = await POST(saveRequest({ ...KEY, entry: ENTRY }));

    expect(await response.json()).toStrictEqual({ success: true, registry: REGISTRY, message: 'Entry saved' });
    expect(vi.mocked(saveRubyRegistryEntry).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(getRubyRegistry).mock.invocationCallOrder[0]);
  });
});

describe('DELETE /api/ruby-registry', () => {
  it('rejects a guest without deleting', async () => {
    const response = await DELETE(deleteRequest({ ...KEY, kanji: '本' }, {}));

    expect(response.status).toBe(401);
    expect(hideRubyRegistryItem).not.toHaveBeenCalled();
  });

  it('answers 400 without deleting for a book outside the book folders', async () => {
    const response = await DELETE(deleteRequest({ directory: 'bookv2-furigana/..', bookName: '..', kanji: '本' }));

    expect(response.status).toBe(400);
    expect(hideRubyRegistryItem).not.toHaveBeenCalled();
  });

  it.each([
    ['an entry', {}, 'entry', 'Entry deleted'],
    ['a suggestion', { type: 'suggestion' }, 'suggestion', 'Suggestion ignored'],
  ])('hides %s and answers the registry', async (_case, typeParam, type, message) => {
    const response = await DELETE(deleteRequest({ ...KEY, kanji: '本', ...typeParam }));

    expect(hideRubyRegistryItem).toHaveBeenCalledWith(KEY, '本', type);
    expect(await response.json()).toStrictEqual({ success: true, registry: REGISTRY, message });
  });
});

describe('a database without the registry table', () => {
  beforeEach(() => {
    vi.mocked(getRubyRegistry).mockRejectedValue(NO_REGISTRY_TABLE);
    vi.mocked(saveRubyRegistryEntry).mockRejectedValue(NO_REGISTRY_TABLE);
    vi.mocked(hideRubyRegistryItem).mockRejectedValue(NO_REGISTRY_TABLE);
  });

  it.each([
    ['a guest reading a preview book', () => GET(registryRequest(PREVIEW_PARENT, PREVIEW_BOOK_NAME))],
    ['the owner reading', () => GET(registryRequest(KEY.directory, KEY.bookName, OWNER_HEADERS))],
    ['the owner saving', () => POST(saveRequest({ ...KEY, entry: { kanji: '本', reading: 'ほん' } }))],
    ['the owner deleting', () => DELETE(deleteRequest({ ...KEY, kanji: '本' }))],
  ])('answers 503 registry_unavailable to %s', async (_case, send) => {
    const response = await send();

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual(UNAVAILABLE_BODY);
  });

  it('answers any other database error as a 500, not as unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getRubyRegistry).mockRejectedValue(Object.assign(new Error('column "note" does not exist'), { code: '42703' }));

    const response = await GET(registryRequest(KEY.directory, KEY.bookName, OWNER_HEADERS));

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('internal_error');
    error.mockRestore();
  });
});
