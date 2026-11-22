import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ROUTES, GUEST_KEY_HEADERS, STORAGE_KEYS } from '@/lib/constants';
import { GUEST_KEY_REQUIRED_EVENT } from '@/lib/guestKeys';
import { bookQuery } from '@/lib/books/bookRef';
import { bookAssetPath, bookAssetUrl } from '@/lib/utils/bookAssetPath';
import {
  ApiError,
  deleteVocabularyEntry,
  fetchDbSyncStatus,
  explainSentence,
  fetchBookMetadata,
  fetchBookText,
  fetchBookmark,
  fetchLibraryProgress,
  fetchNarration,
  fetchRubyRegistry,
  isRubyRegistryUnavailable,
  fetchSession,
  fetchVocabulary,
  listTextFiles,
  login,
  logout,
  prioritize,
  removeRubyRegistryItem,
  request,
  runDbSync,
  saveBookmark,
  saveRubyEntry,
  saveVocabularyEntry,
  synthesizeSpeech,
  translate,
} from './client';

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
    expect(lastCall().init).toMatchObject({ method: 'GET' });
    expect(lastCall().init.signal).toBe(controller.signal);
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

  it("opens the key prompt when Google rejects the guest's stored key with its own status", async () => {
    storedValues.set(STORAGE_KEYS.GUEST_TRANSLATE_KEY, 'rejected-key');
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'upstream_failed', message: 'Translation failed' } }, 400));

    await expect(translate('本')).rejects.toMatchObject({ status: 400, promptedGuestKey: true });
    expect(promptedKinds).toEqual(['translate']);
  });
});

describe('explainSentence', () => {
  it("posts the sentence and its context with the guest's Gemini key", async () => {
    storeGeminiKey('guest-gemini-key');
    fetchMock.mockResolvedValue(jsonResponse({ explanation: '説明', message: '説明を取得しました' }));
    const explanation = { sentence: '本を読む。', context: '前の文。', fileName: 'dir/本', contextSize: 50, mode: 'quick' } as const;

    expect(await explainSentence(explanation)).toEqual({ explanation: '説明', message: '説明を取得しました' });
    expect(lastCall().url).toBe('/api/explain-sentence');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [GUEST_KEY_HEADERS.GEMINI]: 'guest-gemini-key' },
      body: JSON.stringify(explanation),
    });
  });

  it('opens the key prompt after a failure while a guest key is stored', async () => {
    storeGeminiKey('rejected-key');
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'internal_error', message: 'Internal server error' } }, 500));

    await expect(
      explainSentence({ sentence: '本', context: '', fileName: 'dir/本', contextSize: 50, mode: 'quick' })
    ).rejects.toMatchObject({ promptedGuestKey: true });
    expect(promptedKinds).toEqual(['gemini']);
  });
});

describe('prioritize', () => {
  it("posts the page's sentences with the guest's Gemini key", async () => {
    storeGeminiKey('guest-gemini-key');
    fetchMock.mockResolvedValue(jsonResponse({ scores: [5, 1] }));

    expect(await prioritize(['一文。', '二文。'])).toEqual({ scores: [5, 1] });
    expect(lastCall().url).toBe('/api/prioritize');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [GUEST_KEY_HEADERS.GEMINI]: 'guest-gemini-key' },
      body: '{"sentences":["一文。","二文。"]}',
    });
  });

  it('leaves the key prompt closed when the model fails while a key is stored', async () => {
    storeGeminiKey('stored-key');
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'upstream_failed', message: 'No scores' } }, 502));

    await expect(prioritize(['一文。'])).rejects.toMatchObject({ status: 502, promptedGuestKey: false });
    expect(promptedKinds).toEqual([]);
  });

  it('opens the key prompt for a guest without a key', async () => {
    fetchMock.mockResolvedValue(guestKeyRequired('gemini'));

    await expect(prioritize(['一文。'])).rejects.toMatchObject({ status: 401, promptedGuestKey: true });
    expect(promptedKinds).toEqual(['gemini']);
  });
});

describe('synthesizeSpeech', () => {
  it("posts the text, speed and voice with the guest's TTS key", async () => {
    storedValues.set(STORAGE_KEYS.GUEST_TTS_KEY, 'guest-tts-key');
    fetchMock.mockResolvedValue(jsonResponse({ audioContent: 'bXAz', message: '音声を生成しました' }));

    expect(await synthesizeSpeech({ text: '本', speed: 1, voiceGender: 'FEMALE' })).toEqual({
      audioContent: 'bXAz',
      message: '音声を生成しました',
    });
    expect(lastCall().url).toBe('/api/tts');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [GUEST_KEY_HEADERS.TTS]: 'guest-tts-key' },
      body: '{"text":"本","speed":1,"voiceGender":"FEMALE"}',
    });
  });

  it('opens the key prompt when a guest has no TTS key', async () => {
    fetchMock.mockResolvedValue(guestKeyRequired('tts'));

    await expect(synthesizeSpeech({ text: '本' })).rejects.toMatchObject({ promptedGuestKey: true });
    expect(promptedKinds).toEqual(['tts']);
  });

  it("opens the key prompt when Google rejects the guest's stored key, which the route reports as a 502", async () => {
    storedValues.set(STORAGE_KEYS.GUEST_TTS_KEY, 'rejected-key');
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'upstream_failed', message: 'Google TTS エラー (403)' } }, 502));

    await expect(synthesizeSpeech({ text: '本' })).rejects.toMatchObject({ status: 502, promptedGuestKey: true });
    expect(promptedKinds).toEqual(['tts']);
  });
});

describe('fetchBookText', () => {
  const bookTextUrl = `/api/read-public-txt?${bookQuery(BOOK)}`;

  function storedCopy(etag: string) {
    const stored = new Response(JSON.stringify({ text: '保存した本文' }), { headers: { etag } });
    return {
      keys: async () => [],
      delete: async () => true,
      open: async () => ({
        match: async (url: string) => (url === bookTextUrl ? stored.clone() : undefined),
        put: async () => {},
      }),
    };
  }

  it("downloads the book uncached by the browser, with the reader's AbortSignal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: '本文' }));
    const controller = new AbortController();

    expect(await fetchBookText(BOOK, controller.signal)).toBe('本文');
    expect(lastCall().url).toBe(bookTextUrl);
    expect(lastCall().init).toMatchObject({ method: 'GET', cache: 'no-store', headers: {} });
    expect(lastCall().init.signal).toBe(controller.signal);
  });

  it('sends the version of the copy stored under the same URL and reuses it on 204', async () => {
    vi.stubGlobal('caches', storedCopy('"7-full-v1"'));
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    expect(await fetchBookText(BOOK)).toBe('保存した本文');
    expect(lastCall().init.headers).toEqual({ 'x-book-version': '"7-full-v1"' });
  });

  it('throws an ApiError when the server refuses the book', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'preview_only', message: 'Guests may only open the preview books' } }, 403));

    await expect(fetchBookText(BOOK)).rejects.toMatchObject({ status: 403 });
  });
});

describe('fetchNarration', () => {
  const manifest = { audioUrl: 'https://audio.example/book.m4a', unitCount: 1, cues: [{ start: 0, end: 1 }] };

  it("reads the book's manifest with the reader's AbortSignal", async () => {
    fetchMock.mockResolvedValue(jsonResponse(manifest));
    const controller = new AbortController();

    expect(await fetchNarration(BOOK, controller.signal)).toEqual(manifest);
    expect(lastCall().url).toBe(`/api/narration?${bookQuery(BOOK)}`);
    expect(lastCall().init).toMatchObject({ method: 'GET' });
    expect(lastCall().init.signal).toBe(controller.signal);
  });

  it.each([
    [404, 'not_found'],
    [401, 'sign_in_required'],
  ])('answers null for a %i, a text without a recording or a guest', async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code, message: 'No narration' } }, status));

    expect(await fetchNarration(BOOK)).toBeNull();
  });

  it('answers null when an edge answers ok with an HTML page', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    expect(await fetchNarration(BOOK)).toBeNull();
  });

  it('throws an ApiError for any other failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'not_configured', message: 'Narration storage is not configured' } }, 500));

    await expect(fetchNarration(BOOK)).rejects.toMatchObject({ status: 500 });
  });
});

describe('fetchBookMetadata', () => {
  it("reads the metadata JSON from the book's asset path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ title: '本', images: [] }));

    expect(await fetchBookMetadata(BOOK)).toEqual({ title: '本', images: [] });
    expect(lastCall().url).toBe(bookAssetUrl(bookAssetPath(BOOK.directory, BOOK.fileName, '.json')));
  });

  it('answers null for a book without metadata', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'not_found', message: 'No such book asset' } }, 404));

    expect(await fetchBookMetadata(BOOK)).toBeNull();
  });
});

describe('ruby registry calls', () => {
  const KEY = { directory: 'bookv2-furigana', bookName: '本 (上)' };
  const registryResponse = { success: true, registry: { bookTitle: '本', entries: [], suggestions: [] }, message: 'Registry loaded' };
  const encodedBookName = encodeURIComponent('本 (上)');

  it("reads a book's registry by directory and book name", async () => {
    fetchMock.mockResolvedValue(jsonResponse(registryResponse));

    expect(await fetchRubyRegistry(KEY)).toEqual(registryResponse);
    expect(lastCall().url).toBe(`/api/ruby-registry?directory=bookv2-furigana&bookName=${encodedBookName}`);
  });

  it('posts an entry under the registry key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(registryResponse));
    const entry = { kanji: '本', reading: 'ほん', source: 'user', note: '' } as const;

    await saveRubyEntry({ ...KEY, entry });

    expect(lastCall().url).toBe('/api/ruby-registry');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: KEY.directory, bookName: KEY.bookName, entry }),
    });
  });

  it.each(['entry', 'suggestion'] as const)('deletes a %s by kanji', async (type) => {
    fetchMock.mockResolvedValue(jsonResponse(registryResponse));

    await removeRubyRegistryItem(KEY, '本', type);

    expect(lastCall().url).toBe(
      `/api/ruby-registry?directory=bookv2-furigana&bookName=${encodedBookName}&kanji=${encodeURIComponent('本')}&type=${type}`
    );
    expect(lastCall().init).toMatchObject({ method: 'DELETE', headers: {}, body: undefined });
  });

  it('tells a server without the registry table apart from any other failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'registry_unavailable', message: 'The ruby registry is not available on this server yet' } }, 503)
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'internal_error', message: 'Internal server error' } }, 500));

    const unavailable = await fetchRubyRegistry(KEY).catch((error: unknown) => error);
    const failed = await fetchRubyRegistry(KEY).catch((error: unknown) => error);

    expect(isRubyRegistryUnavailable(unavailable)).toBe(true);
    expect(isRubyRegistryUnavailable(failed)).toBe(false);
    expect(isRubyRegistryUnavailable(new Error('network down'))).toBe(false);
  });
});

describe('library calls', () => {
  it('lists the text files', async () => {
    const listing = { directories: ['d'], filesByDirectory: { d: ['本'] }, files: ['d/本'] };
    fetchMock.mockResolvedValue(jsonResponse(listing));

    expect(await listTextFiles()).toEqual(listing);
    expect(lastCall().url).toBe('/api/list-text-files');
    expect(lastCall().init).toMatchObject({ method: 'GET', headers: {} });
  });

  it("reads every book's progress", async () => {
    const progress = { 'd/本': { progress: 50, totalCharacters: 10, bookmarkPage: 2, totalPages: 4, bookmarkUpdatedAt: null, createdAt: null } };
    fetchMock.mockResolvedValue(jsonResponse(progress));

    expect(await fetchLibraryProgress()).toEqual(progress);
    expect(lastCall().url).toBe('/api/library-progress');
  });
});

describe('vocabulary calls', () => {
  it('lists the vocabulary entries', async () => {
    const list = { success: true, entries: [], count: 0 };
    fetchMock.mockResolvedValue(jsonResponse(list));

    expect(await fetchVocabulary()).toEqual(list);
    expect(lastCall().url).toBe('/api/vocabulary');
    expect(lastCall().init).toMatchObject({ method: 'GET', headers: {} });
  });

  it('posts a word to save as JSON and returns whether it was new', async () => {
    const draft = { ...BOOK, word: '言葉', reading: 'ことば', sentence: '言葉を選ぶ。', paragraphText: '言葉を選ぶ。' };
    const saved = { success: true, message: 'Vocabulary entry already saved', entry: { id: 'entry-1', ...draft }, created: false };
    fetchMock.mockResolvedValue(jsonResponse(saved));

    expect(await saveVocabularyEntry(draft)).toEqual(saved);
    expect(lastCall().url).toBe('/api/vocabulary');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
  });

  it('deletes one entry by id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, message: 'Vocabulary entry deleted' }));

    await deleteVocabularyEntry('42');

    expect(lastCall().url).toBe('/api/vocabulary/42');
    expect(lastCall().init).toMatchObject({ method: 'DELETE', headers: {}, body: undefined });
  });

  it('keeps the top-level message the vocabulary page shows', async () => {
    const message = 'Failed to fetch vocabulary entries';
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'internal_error', message }, message }, 500));

    await expect(fetchVocabulary()).rejects.toMatchObject({ body: { message } });
  });
});

describe('auth calls', () => {
  it('posts the password to log in', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Login successful', success: true }));

    await login('secret');

    expect(lastCall().url).toBe('/api/auth?action=login');
    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"password":"secret"}',
    });
  });

  it('keeps the top-level message of a refused login', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'invalid_password', message: 'Invalid password' }, message: 'Invalid password' }, 401)
    );

    await expect(login('wrong')).rejects.toMatchObject({ status: 401, body: { message: 'Invalid password' } });
  });

  it('posts an empty logout with no content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Logged out successfully', success: true }));

    await logout();

    expect(lastCall().url).toBe('/api/auth?action=logout');
    expect(lastCall().init).toMatchObject({ method: 'POST', headers: {}, body: undefined });
  });

  it('reads whether the visitor is signed in', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: false }));

    expect(await fetchSession()).toEqual({ authenticated: false });
    expect(lastCall().url).toBe('/api/auth?action=session');
  });
});

describe('db sync calls', () => {
  it('reads the differences between the databases', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ diffs: [] }));

    expect(await fetchDbSyncStatus()).toEqual({ diffs: [] });
    expect(lastCall().url).toBe('/api/db-sync');
    expect(lastCall().init).toMatchObject({ method: 'GET', headers: {} });
  });

  it('posts the sync direction', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, results: [] }));

    await runDbSync('pull');

    expect(lastCall().init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"direction":"pull"}',
    });
  });

  it("shows the server's error message, or the status when there is none", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'not_configured', message: 'Sync not available - PROD_DATABASE_URL not configured' } }, 503)
    );
    await expect(fetchDbSyncStatus()).rejects.toThrow('Sync not available - PROD_DATABASE_URL not configured');
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(fetchDbSyncStatus()).rejects.toThrow('HTTP 500');
  });
});
