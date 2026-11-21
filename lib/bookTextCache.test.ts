import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBookTextCache, fetchBookText } from './bookTextCache';

const URL = '/api/read-public-txt?fileName=ほん';

function bookResponse(text: string, etag: string): Response {
  return new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json', etag } });
}

function fakeCacheStorage() {
  const entries = new Map<string, Response>();
  const cache = {
    match: async (key: string) => entries.get(key)?.clone(),
    put: async (key: string, response: Response) => {
      entries.set(key, response);
    },
  };
  return {
    entries,
    storage: {
      open: async () => cache,
      delete: vi.fn(async () => entries.clear()),
    },
  };
}

let cacheStorage: ReturnType<typeof fakeCacheStorage>;
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  cacheStorage = fakeCacheStorage();
  vi.stubGlobal('caches', cacheStorage.storage);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('fetchBookText', () => {
  it('downloads a book it has not stored and keeps a copy', async () => {
    fetchMock.mockResolvedValue(bookResponse('本文', 'W/"10-1-full"'));

    expect(await fetchBookText(URL)).toBe('本文');
    expect(cacheStorage.entries.has(URL)).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({});
  });

  it('sends the stored version and reuses the copy when the server answers 204', async () => {
    fetchMock.mockResolvedValueOnce(bookResponse('本文', 'W/"10-1-full"'));
    await fetchBookText(URL);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await fetchBookText(URL)).toBe('本文');
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ 'x-book-version': 'W/"10-1-full"' });
  });

  it('replaces the copy when the book changed', async () => {
    fetchMock.mockResolvedValueOnce(bookResponse('古い本文', '"10-1-full"'));
    await fetchBookText(URL);
    fetchMock.mockResolvedValueOnce(bookResponse('新しい本文', '"12-2-full"'));
    await fetchBookText(URL);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await fetchBookText(URL)).toBe('新しい本文');
  });

  it('does not store a response without an ETag, such as a missing book', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '' }), { status: 200 }));

    expect(await fetchBookText(URL)).toBe('');
    expect(cacheStorage.entries.has(URL)).toBe(false);
  });

  it('throws on a failed request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '' }), { status: 500 }));

    await expect(fetchBookText(URL)).rejects.toThrow('Failed to load content');
  });

  it('reads from the network when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    fetchMock.mockResolvedValue(bookResponse('本文', '"10-1-full"'));

    expect(await fetchBookText(URL)).toBe('本文');
  });
});

describe('clearBookTextCache', () => {
  it('removes every stored book', async () => {
    fetchMock.mockResolvedValue(bookResponse('本文', '"10-1-full"'));
    await fetchBookText(URL);

    await clearBookTextCache();

    expect(cacheStorage.entries.size).toBe(0);
  });
});
