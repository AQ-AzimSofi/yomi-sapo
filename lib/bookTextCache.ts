import { BOOK_VERSION_HEADER } from '@/lib/utils/etag';

const CACHE_NAME = 'book-text-v1';

// CloudFront drops If-None-Match before it reaches the app, so the browser's HTTP
// cache can never revalidate a book. The reader keeps its own copy in Cache
// Storage instead and sends the stored ETag in a custom header; the server
// answers 204 when that version is still current.

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
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
    await cache.put(url, response.clone());
  }
  return readText(response);
}

/** Removes every stored book, so a signed-out browser keeps no full text. */
export async function clearBookTextCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(CACHE_NAME);
}
