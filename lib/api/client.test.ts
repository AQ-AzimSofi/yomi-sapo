import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ROUTES, GUEST_KEY_HEADERS, STORAGE_KEYS } from '@/lib/constants';
import { GUEST_KEY_REQUIRED_EVENT } from '@/lib/guestKeys';
import { bookQuery } from '@/lib/books/bookRef';
import { ApiError, fetchBookmark, request, saveBookmark, translate } from './client';

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let storedValues: Map<string, string>;
let promptedKinds: string[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, init: init ?? {} };
}

const BOOK = { directory: 'bookv2-furigana/本', fileName: '本-rephrase-furigana' };

function storeGeminiKey(key: string): void {
  storedValues.set(STORAGE_KEYS.GUEST_GEMINI_KEY, key);
}

function guestKeyRequired(kind: string): Response {
  return jsonResponse({ error: { code: 'guest_key_required', message: 'Sign in or add your own key.' }, requiresGuestKey: kind }, 401);
}

beforeEach(() => {
  storedValues = new Map();
  promptedKinds = [];
  const browserWindow = new EventTarget();
  browserWindow.addEventListener(GUEST_KEY_REQUIRED_EVENT, (event) => {
    promptedKinds.push((event as CustomEvent<{ kind: string }>).detail.kind);
  });
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
    removeItem: (key: string) => storedValues.delete(key),
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('request URLs', () => {
  it('encodes query params the way bookQuery encodes a book', async () => {
    const book = { directory: 'bookv2-furigana/本 (上)', fileName: "a&b=c'd" };

    await request(API_ROUTES.READ_BOOKMARK, { query: { ...book } });

    expect(lastCall().url).toBe(`/api/read-bookmark?${bookQuery(book)}`);
  });

  it('uses the bare route without params', async () => {
    await request(API_ROUTES.VOCABULARY);

    expect(lastCall().url).toBe('/api/vocabulary');
  });

  it('adds params after the action a route already carries', async () => {
    await request(API_ROUTES.AUTH_SESSION, { query: { next: '/read' } });

    expect(lastCall().url).toBe('/api/auth?action=session&next=%2Fread');
  });

  it('appends one encoded path segment', async () => {
    await request(API_ROUTES.VOCABULARY, { method: 'DELETE', pathSegment: 'entry/1' });

    expect(lastCall().url).toBe('/api/vocabulary/entry%2F1');
    expect(lastCall().init.method).toBe('DELETE');
  });
});

describe('request bodies and headers', () => {
  it('sends a GET with no headers and no body by default', async () => {
    await request(API_ROUTES.LIST_TEXT_FILES);

    expect(lastCall().init).toMatchObject({ method: 'GET', headers: {}, body: undefined });
  });

  it('sends a body as JSON with a JSON content type', async () => {
    await request(API_ROUTES.TRANSLATE, { method: 'POST', body: { text: '本' } });

    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"text":"本"}',
    });
  });

  it("attaches the guest's stored key for the route's key kind", async () => {
    storeGeminiKey('guest-gemini-key');

    await request(API_ROUTES.EXPLAIN_SENTENCE, {
      method: 'POST',
      body: { sentence: '本' },
      guestKey: { kind: 'gemini', promptOn: 'any-failure' },
    });

    expect(lastCall().init.headers).toEqual({
      'Content-Type': 'application/json',
      [GUEST_KEY_HEADERS.GEMINI]: 'guest-gemini-key',
    });
  });

  it('sends no guest key header when no key is stored', async () => {
    await request(API_ROUTES.EXPLAIN_SENTENCE, {
      method: 'POST',
      body: { sentence: '本' },
      guestKey: { kind: 'gemini', promptOn: 'any-failure' },
    });

    expect(lastCall().init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('passes the fetch cache mode and extra headers through', async () => {
    await request(API_ROUTES.READ_TEXT, { cache: 'no-store', headers: { 'x-book-version': '"1"' } });

    expect(lastCall().init).toMatchObject({ cache: 'no-store', headers: { 'x-book-version': '"1"' } });
  });
});

describe('request results', () => {
  it('returns the JSON body of a 2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: '本文' }));

    expect(await request<{ text: string }>(API_ROUTES.READ_BOOKMARK)).toEqual({ text: '本文' });
  });

  it('passes the AbortSignal and rejects with the abort when it fires', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
    );
    const controller = new AbortController();

    const pending = request(API_ROUTES.READ_BOOKMARK, { signal: controller.signal });
    controller.abort();

    expect(lastCall().init.signal).toBe(controller.signal);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('request failures', () => {
  it('throws an ApiError with the status and the standard error body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'preview_only', message: 'Guests may only open the preview books' } }, 403));

    const error = await request(API_ROUTES.READ_TEXT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      message: 'Guests may only open the preview books',
      body: { error: { code: 'preview_only' } },
      promptedGuestKey: false,
    });
  });

  it('keeps the status text for messages that show it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500, statusText: 'Internal Server Error' }));

    await expect(request(API_ROUTES.READ_TEXT)).rejects.toMatchObject({ statusText: 'Internal Server Error' });
  });

  it('names the status when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(request(API_ROUTES.DB_SYNC)).rejects.toMatchObject({ message: 'HTTP 502', body: null });
  });
});

describe('the guest key prompt', () => {
  const explainWith = (promptOn: 'any-failure' | 'unauthorized') =>
    request(API_ROUTES.EXPLAIN_SENTENCE, {
      method: 'POST',
      body: { sentence: '本' },
      guestKey: { kind: 'gemini', promptOn },
    }).catch((caught: unknown) => caught);

  it('opens when the server asks a guest for their key', async () => {
    fetchMock.mockResolvedValue(guestKeyRequired('gemini'));

    const error = await explainWith('any-failure');

    expect(promptedKinds).toEqual(['gemini']);
    expect(error).toMatchObject({ status: 401, promptedGuestKey: true, body: { requiresGuestKey: 'gemini' } });
  });

  it('does not open when the server asks for another kind of key', async () => {
    fetchMock.mockResolvedValue(guestKeyRequired('tts'));

    await explainWith('any-failure');

    expect(promptedKinds).toEqual([]);
  });

  it('opens on any failure while a key is stored, since the key may have been rejected', async () => {
    storeGeminiKey('rejected-key');
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'internal_error', message: 'Internal server error' } }, 500));

    const error = await explainWith('any-failure');

    expect(promptedKinds).toEqual(['gemini']);
    expect(error).toMatchObject({ promptedGuestKey: true, message: 'Internal server error' });
  });

  it('stays closed after a failure when no key is stored and none was asked for', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'internal_error', message: 'Internal server error' } }, 500));

    const error = await explainWith('any-failure');

    expect(promptedKinds).toEqual([]);
    expect(error).toMatchObject({ promptedGuestKey: false });
  });

  it('opens only on a 401 for a route that prompts only when unauthorized', async () => {
    storeGeminiKey('stored-key');
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'upstream_failed', message: 'No scores' } }, 502));
    await explainWith('unauthorized');
    fetchMock.mockResolvedValueOnce(guestKeyRequired('gemini'));
    await explainWith('unauthorized');

    expect(promptedKinds).toEqual(['gemini']);
  });

  it('never opens for a request that sends no guest key', async () => {
    storeGeminiKey('stored-key');
    fetchMock.mockResolvedValue(guestKeyRequired('gemini'));

    await request(API_ROUTES.READ_BOOKMARK).catch(() => {});

    expect(promptedKinds).toEqual([]);
  });
});

describe('fetchBookmark', () => {
  it("reads the book's bookmark with the reader's AbortSignal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: '一文', page: 3 }));
    const controller = new AbortController();

    expect(await fetchBookmark(BOOK, controller.signal)).toEqual({ text: '一文', page: 3 });
    expect(lastCall().url).toBe(`/api/read-bookmark?${bookQuery(BOOK)}`);
    expect(lastCall().init).toMatchObject({ method: 'GET', signal: controller.signal });
  });

  it('answers null when the server refuses, as it does for a guest', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'sign_in_required', message: 'Sign in required' } }, 401));

    expect(await fetchBookmark(BOOK)).toBeNull();
  });

  it('still throws when the request never reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchBookmark(BOOK)).rejects.toThrow('Failed to fetch');
  });
});

describe('saveBookmark', () => {
  it('posts the book, the bookmarked text and its page as JSON', async () => {
    await saveBookmark({ ...BOOK, content: '一文', page: 3 });

    expect(lastCall().url).toBe('/api/write-bookmark');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: BOOK.directory, fileName: BOOK.fileName, content: '一文', page: 3 }),
    });
  });

  it('throws an ApiError when the bookmark is not saved', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'invalid_request', message: '無効なファイル名です' } }, 400));

    await expect(saveBookmark({ ...BOOK, content: '一文' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('translate', () => {
  it("posts the text with the guest's translate key", async () => {
    storedValues.set(STORAGE_KEYS.GUEST_TRANSLATE_KEY, 'guest-translate-key');
    fetchMock.mockResolvedValue(jsonResponse({ translatedText: 'A book' }));

    expect(await translate('本')).toEqual({ translatedText: 'A book' });
    expect(lastCall().url).toBe('/api/translate');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [GUEST_KEY_HEADERS.TRANSLATE]: 'guest-translate-key' },
      body: '{"text":"本"}',
    });
  });

  it('opens the key prompt when a guest has no translate key', async () => {
    fetchMock.mockResolvedValue(guestKeyRequired('translate'));

    await expect(translate('本')).rejects.toMatchObject({ promptedGuestKey: true });
    expect(promptedKinds).toEqual(['translate']);
  });
});
