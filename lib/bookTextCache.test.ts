import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBookTextCache, readBookTextThroughCache } from './bookTextCache';

const URL = '/api/read-public-txt?directory=d&fileName=ほん';
const ORPHANED_CACHE = 'book-text-v1';
const OTHER_APP_CACHE = 'other-app-cache';

function bookResponse(text: string, etag: string): Response {
  return new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json', etag } });
}

function fakeCacheStorage(existingCacheNames: string[] = []) {
  const cachesByName = new Map<string, Map<string, Response>>(existingCacheNames.map((name) => [name, new Map()]));
  const openNamed = (name: string) => {
    const entries = cachesByName.get(name) ?? new Map<string, Response>();
    cachesByName.set(name, entries);
    return {
      match: async (key: string) => entries.get(key)?.clone(),
      put: async (key: string, response: Response) => {
        entries.set(key, response);
      },
    };
  };
  const storedUrls = () => [...cachesByName.values()].flatMap((entries) => [...entries.keys()]);
  return {
    cachesByName,
    storedUrls,
    storage: {
      open: vi.fn(async (name: string) => openNamed(name)),
      keys: async () => [...cachesByName.keys()],
      delete: vi.fn(async (name: string) => cachesByName.delete(name)),
    },
  };
}

let cacheStorage: ReturnType<typeof fakeCacheStorage>;
const download = vi.fn<(versionHeaders: Record<string, string>) => Promise<Response>>();

function readThroughCache(url: string): Promise<string> {
  return readBookTextThroughCache(url, download);
}

function useCacheStorage(existingCacheNames: string[]): void {
  cacheStorage = fakeCacheStorage(existingCacheNames);
  vi.stubGlobal('caches', cacheStorage.storage);
}

beforeEach(() => {
  useCacheStorage([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  download.mockReset();
});

describe('readBookTextThroughCache', () => {
  it('downloads a book it has not stored and keeps a copy', async () => {
    download.mockResolvedValue(bookResponse('本文', 'W/"10-1-full"'));

    expect(await readThroughCache(URL)).toBe('本文');
    expect(cacheStorage.storedUrls()).toEqual([URL]);
    expect(download).toHaveBeenCalledWith({});
  });

  it('sends the stored version and reuses the copy when the server answers 204', async () => {
    download.mockResolvedValueOnce(bookResponse('本文', 'W/"10-1-full"'));
    await readThroughCache(URL);
    download.mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await readThroughCache(URL)).toBe('本文');
    expect(download).toHaveBeenLastCalledWith({ 'x-book-version': 'W/"10-1-full"' });
  });

  it('replaces the copy when the book changed', async () => {
    download.mockResolvedValueOnce(bookResponse('古い本文', '"10-1-full"'));
    await readThroughCache(URL);
    download.mockResolvedValueOnce(bookResponse('新しい本文', '"12-2-full"'));
    await readThroughCache(URL);
    download.mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await readThroughCache(URL)).toBe('新しい本文');
  });

  it('does not store a response without an ETag, such as a missing book', async () => {
    download.mockResolvedValue(new Response(JSON.stringify({ text: '' }), { status: 200 }));

    expect(await readThroughCache(URL)).toBe('');
    expect(cacheStorage.storedUrls()).toEqual([]);
  });

  it('passes a failed download on and stores nothing', async () => {
    download.mockRejectedValue(new Error('HTTP 500'));

    await expect(readThroughCache(URL)).rejects.toThrow('HTTP 500');
    expect(cacheStorage.storedUrls()).toEqual([]);
  });

  it('throws when the server reports an unchanged book that is not stored', async () => {
    download.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(readThroughCache(URL)).rejects.toThrow('not stored');
  });

  it('still returns the downloaded text when storing it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failingCache = { match: async () => undefined, put: async () => Promise.reject(new Error('QuotaExceededError')) };
    vi.stubGlobal('caches', { open: async () => failingCache, keys: async () => [], delete: vi.fn() });
    download.mockResolvedValue(bookResponse('本文', '"10-1-full"'));

    expect(await readThroughCache(URL)).toBe('本文');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reads from the network when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    download.mockResolvedValue(bookResponse('本文', '"10-1-full"'));

    expect(await readThroughCache(URL)).toBe('本文');
  });

  it('reads from the network when Cache Storage refuses to list the older caches', async () => {
    vi.stubGlobal('caches', { open: vi.fn(), keys: async () => Promise.reject(new Error('SecurityError')), delete: vi.fn() });
    download.mockResolvedValue(bookResponse('本文', '"10-1-full"'));

    expect(await readThroughCache(URL)).toBe('本文');
  });

  it('keeps books out of the cache that older readers filled under the combined-path URLs', async () => {
    useCacheStorage([ORPHANED_CACHE]);
    download.mockResolvedValue(bookResponse('本文', '"10-1-full"'));

    await readThroughCache(URL);

    expect(cacheStorage.storage.open).not.toHaveBeenCalledWith(ORPHANED_CACHE);
  });

  it('deletes older book text caches and leaves other caches alone', async () => {
    useCacheStorage([ORPHANED_CACHE, OTHER_APP_CACHE]);
    download.mockResolvedValue(bookResponse('本文', '"10-1-full"'));

    await readThroughCache(URL);

    const cacheNames = [...cacheStorage.cachesByName.keys()];
    expect(cacheNames).not.toContain(ORPHANED_CACHE);
    expect(cacheNames).toContain(OTHER_APP_CACHE);
    expect(cacheStorage.storedUrls()).toEqual([URL]);
  });
});

describe('clearBookTextCache', () => {
  it('does not throw when Cache Storage refuses the delete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('caches', {
      open: vi.fn(),
      keys: async () => [ORPHANED_CACHE],
      delete: async () => Promise.reject(new Error('SecurityError')),
    });

    await expect(clearBookTextCache()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('removes every stored book', async () => {
    download.mockResolvedValue(bookResponse('本文', '"10-1-full"'));
    await readThroughCache(URL);

    await clearBookTextCache();

    expect(cacheStorage.storedUrls()).toEqual([]);
  });

  it('removes books stored under an older cache name and leaves other caches alone', async () => {
    useCacheStorage([ORPHANED_CACHE, OTHER_APP_CACHE]);

    await clearBookTextCache();

    expect([...cacheStorage.cachesByName.keys()]).toEqual([OTHER_APP_CACHE]);
  });
});
