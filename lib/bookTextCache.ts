import { BOOK_VERSION_HEADER } from '@/lib/utils/etag';

// Bump the version when the stored URLs or bodies change. v1 was keyed by the
// combined fileName=directory/file URL the reader no longer requests.
const CACHE_NAME_PREFIX = 'book-text-';
const CACHE_NAME = `${CACHE_NAME_PREFIX}v2`;

// CloudFront drops If-None-Match before it reaches the app, so the browser's HTTP
// cache can never revalidate a book. The reader keeps its own copy in Cache
// Storage instead and sends the stored ETag in a custom header; the server
// answers 204 when that version is still current.

async function deleteBookTextCaches({ keep }: { keep: string | null }): Promise<void> {
  const cacheNames = await caches.keys();
  const staleNames = cacheNames.filter((name) => name.startsWith(CACHE_NAME_PREFIX) && name !== keep);
  await Promise.all(staleNames.map((name) => caches.delete(name)));
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    await deleteBookTextCaches({ keep: CACHE_NAME });
    return await caches.open(CACHE_NAME);
  } catch {
    // Cache Storage is unavailable in some private modes; read from the network.
    return null;
  }
}

async function readText(response: Response): Promise<string> {
  const body: { text?: string } = await response.json();
  return body.text ?? '';
}

/** Fetches a book's text, reusing the stored copy when the server says it is current. */
export async function fetchBookText(url: string, signal?: AbortSignal): Promise<string> {
  const cache = await openCache();
  const cached = cache ? await cache.match(url) : undefined;
  const storedVersion = cached?.headers.get('etag');
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: storedVersion ? { [BOOK_VERSION_HEADER]: storedVersion } : {},
  });

  if (response.status === 204) {
    if (!cached) throw new Error('The server reported an unchanged book that is not stored');
    return readText(cached);
  }
  if (!response.ok) throw new Error('Failed to load content');
  if (cache && response.headers.get('etag')) {
    await storeBestEffort(cache, url, response.clone());
  }
  return readText(response);
}

// The copy only saves bandwidth, so a full disk or a restricted storage context
// must never stop a downloaded book from opening.
async function storeBestEffort(cache: Cache, url: string, response: Response): Promise<void> {
  try {
    await cache.put(url, response);
  } catch (error) {
    console.warn('Could not store the book for next time:', error);
  }
}

/** Removes every stored book, so a signed-out browser keeps no full text. */
export async function clearBookTextCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await deleteBookTextCaches({ keep: null });
  } catch (error) {
    // Same private modes where opening the cache fails; nothing was stored there.
    console.warn('Could not clear stored books:', error);
  }
}
