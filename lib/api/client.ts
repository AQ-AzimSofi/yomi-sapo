/**
 * The browser's one way to call the app's API routes. URLs come from API_ROUTES,
 * a response outside 2xx becomes an ApiError, and paid routes carry the guest's
 * own key. Browser-safe: nothing here may import server-only code.
 */
import { API_ROUTES } from '@/lib/constants';
import { guestKeyHeaders, promptGuestKeyOnFailure, type GuestKeyKind } from '@/lib/guestKeys';
import { isRecord } from '@/lib/utils/typeGuards';
import { bookAssetPath } from '@/lib/utils/bookAssetPath';
import { readBookTextThroughCache } from '@/lib/bookTextCache';
import type { BookRef } from '@/lib/books/bookRef';
import type { BookMetadata, NarrationManifest } from '@/lib/types';
import type {
  ApiErrorResponse,
  AuthResponse,
  BookmarkResponse,
  DbSyncDirection,
  DbSyncRequest,
  DbSyncResponse,
  DbSyncStatusResponse,
  DeleteVocabularyResponse,
  ExplanationRequest,
  ExplanationResponse,
  LibraryProgressResponse,
  LoginRequest,
  PrioritizeRequest,
  PrioritizeResponse,
  RubyRegistryItemType,
  RubyRegistryKey,
  RubyRegistryResponse,
  SaveBookmarkRequest,
  SaveRubyEntryRequest,
  SessionResponse,
  TextFileListResponse,
  TranslateRequest,
  TranslateResponse,
  TTSRequest,
  TTSResponse,
  VocabularyListResponse,
  WriteResponse,
} from './contracts';

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];

/**
 * When a failed paid request opens the guest key modal: after any failure, since a
 * stored key may have been rejected, or only after a 401.
 */
export type GuestKeyPromptRule = 'any-failure' | 'unauthorized';

export interface GuestKeyUse {
  kind: GuestKeyKind;
  promptOn: GuestKeyPromptRule;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, string>;
  // One path segment after the route, such as a vocabulary entry id.
  pathSegment?: string;
  body?: unknown;
  headers?: Record<string, string>;
  guestKey?: GuestKeyUse;
  signal?: AbortSignal;
  cache?: RequestCache;
}

interface FailedResponse {
  status: number;
  statusText: string;
  body: ApiErrorResponse | null;
  promptedGuestKey: boolean;
}

/** A response outside 2xx. `body` is null when the response was not a JSON object. */
export class ApiError extends Error {
  name = 'ApiError';
  readonly status: number;
  readonly statusText: string;
  readonly body: ApiErrorResponse | null;
  // Whether this failure opened the guest key modal.
  readonly promptedGuestKey: boolean;

  constructor({ status, statusText, body, promptedGuestKey }: FailedResponse) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.promptedGuestKey = promptedGuestKey;
  }
}

// Encoded like bookQuery, so a book's URL is the same whichever code builds it.
function toQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

function apiUrl(route: ApiRoute, { query, pathSegment }: RequestOptions): string {
  const path = pathSegment === undefined ? route : `${route}/${encodeURIComponent(pathSegment)}`;
  if (!query) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${toQueryString(query)}`;
}

function requestHeaders({ body, guestKey, headers }: RequestOptions): Record<string, string> {
  const contentType: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' };
  const guestKeyHeader = guestKey ? guestKeyHeaders(guestKey.kind) : {};
  return { ...contentType, ...guestKeyHeader, ...headers };
}

async function readErrorBody(response: Response): Promise<ApiErrorResponse | null> {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) ? (body as ApiErrorResponse) : null;
}

function promptForGuestKey(guestKey: GuestKeyUse, status: number, body: ApiErrorResponse | null): boolean {
  if (guestKey.promptOn === 'unauthorized' && status !== 401) return false;
  return promptGuestKeyOnFailure(guestKey.kind, { status, requiresGuestKey: body?.requiresGuestKey });
}

async function toApiError(response: Response, guestKey: GuestKeyUse | undefined): Promise<ApiError> {
  const body = await readErrorBody(response);
  const promptedGuestKey = guestKey ? promptForGuestKey(guestKey, response.status, body) : false;
  return new ApiError({ status: response.status, statusText: response.statusText, body, promptedGuestKey });
}

/** Sends a request and returns the response when it is 2xx; otherwise throws ApiError. */
async function send(route: ApiRoute, options: RequestOptions = {}): Promise<Response> {
  const response = await fetch(apiUrl(route, options), {
    method: options.method ?? 'GET',
    headers: requestHeaders(options),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    cache: options.cache,
  });
  if (response.ok) return response;
  throw await toApiError(response, options.guestKey);
}

/** Calls an API route and returns its JSON body; throws ApiError for a response outside 2xx. */
export async function request<T>(route: ApiRoute, options: RequestOptions = {}): Promise<T> {
  const response = await send(route, options);
  return response.json();
}

function bookParams(book: BookRef): Record<string, string> {
  return { directory: book.directory, fileName: book.fileName };
}

// For a read whose failure the page shows as "nothing there"; a network failure still throws.
function nullOnApiError(error: unknown): null {
  if (error instanceof ApiError) return null;
  throw error;
}

export async function login(password: string): Promise<AuthResponse> {
  const body: LoginRequest = { password };
  return request<AuthResponse>(API_ROUTES.AUTH_LOGIN, { method: 'POST', body });
}

export async function logout(): Promise<AuthResponse> {
  return request<AuthResponse>(API_ROUTES.AUTH_LOGOUT, { method: 'POST' });
}

export async function fetchSession(): Promise<SessionResponse> {
  return request<SessionResponse>(API_ROUTES.AUTH_SESSION);
}

export async function listTextFiles(): Promise<TextFileListResponse> {
  return request<TextFileListResponse>(API_ROUTES.LIST_TEXT_FILES);
}

export async function fetchLibraryProgress(): Promise<LibraryProgressResponse> {
  return request<LibraryProgressResponse>(API_ROUTES.LIBRARY_PROGRESS);
}

/** A book's text. The reader's stored copy is reused when the server says it is still current. */
export async function fetchBookText(book: BookRef, signal?: AbortSignal): Promise<string> {
  const query = bookParams(book);
  return readBookTextThroughCache(apiUrl(API_ROUTES.READ_TEXT, { query }), (versionHeaders) =>
    send(API_ROUTES.READ_TEXT, { query, headers: versionHeaders, signal, cache: 'no-store' })
  );
}

/** The saved bookmark, or null when the server gives none (guests have no bookmarks). */
export async function fetchBookmark(book: BookRef, signal?: AbortSignal): Promise<BookmarkResponse | null> {
  return request<BookmarkResponse>(API_ROUTES.READ_BOOKMARK, { query: bookParams(book), signal }).catch(nullOnApiError);
}

/** The metadata the EPUB converter wrote for a book, or null when it has none (not every book does). */
export async function fetchBookMetadata(book: BookRef): Promise<BookMetadata | null> {
  return request<BookMetadata>(API_ROUTES.BOOK_ASSET, {
    query: { path: bookAssetPath(book.directory, book.fileName, '.json') },
  }).catch(nullOnApiError);
}

// 404 means this text has no recording and 401 means a guest, who is never served
// one. Both are the normal case, not a fault to show.
const NO_RECORDING_STATUSES = [401, 404];

function nullWhenNoRecording(error: unknown): null {
  if (error instanceof ApiError && NO_RECORDING_STATUSES.includes(error.status)) return null;
  throw error;
}

/**
 * The narration manifest paired with a book, or null when there is none to play.
 * It is not validated here: the caller checks it against the text it will play.
 */
export async function fetchNarration(book: BookRef, signal?: AbortSignal): Promise<NarrationManifest | null> {
  const response = await send(API_ROUTES.NARRATION, { query: bookParams(book), signal }).catch(nullWhenNoRecording);
  if (!response) return null;
  // An edge or proxy can answer with an HTML body and a perfectly ok status.
  if (!response.headers.get('content-type')?.includes('json')) return null;
  return response.json();
}

export async function saveBookmark(bookmark: SaveBookmarkRequest): Promise<WriteResponse> {
  return request<WriteResponse>(API_ROUTES.WRITE_BOOKMARK, { method: 'POST', body: bookmark });
}

export async function translate(text: string): Promise<TranslateResponse> {
  const body: TranslateRequest = { text };
  return request<TranslateResponse>(API_ROUTES.TRANSLATE, {
    method: 'POST',
    body,
    guestKey: { kind: 'translate', promptOn: 'any-failure' },
  });
}

export async function explainSentence(explanation: ExplanationRequest): Promise<ExplanationResponse> {
  return request<ExplanationResponse>(API_ROUTES.EXPLAIN_SENTENCE, {
    method: 'POST',
    body: explanation,
    guestKey: { kind: 'gemini', promptOn: 'any-failure' },
  });
}

/** Base64 MP3 of the text, in the guest's own TTS key when they have one. */
export async function synthesizeSpeech(speech: TTSRequest): Promise<TTSResponse> {
  return request<TTSResponse>(API_ROUTES.TTS, {
    method: 'POST',
    body: speech,
    guestKey: { kind: 'tts', promptOn: 'any-failure' },
  });
}

export async function fetchVocabulary(): Promise<VocabularyListResponse> {
  return request<VocabularyListResponse>(API_ROUTES.VOCABULARY);
}

export async function deleteVocabularyEntry(id: string): Promise<DeleteVocabularyResponse> {
  return request<DeleteVocabularyResponse>(API_ROUTES.VOCABULARY, { method: 'DELETE', pathSegment: id });
}

/** Compares the local and production databases (local dev server only). */
export async function fetchDbSyncStatus(): Promise<DbSyncStatusResponse> {
  return request<DbSyncStatusResponse>(API_ROUTES.DB_SYNC);
}

export async function runDbSync(direction: DbSyncDirection): Promise<DbSyncResponse> {
  const body: DbSyncRequest = { direction };
  return request<DbSyncResponse>(API_ROUTES.DB_SYNC, { method: 'POST', body });
}

function rubyRegistryParams({ directory, bookName }: RubyRegistryKey): Record<string, string> {
  return { directory, bookName };
}

export async function fetchRubyRegistry(key: RubyRegistryKey): Promise<RubyRegistryResponse> {
  return request<RubyRegistryResponse>(API_ROUTES.RUBY_REGISTRY, { query: rubyRegistryParams(key) });
}

export async function saveRubyEntry(entry: SaveRubyEntryRequest): Promise<RubyRegistryResponse> {
  return request<RubyRegistryResponse>(API_ROUTES.RUBY_REGISTRY, { method: 'POST', body: entry });
}

/** Deletes an entry, or ignores a suggestion so it is not offered again. */
export async function removeRubyRegistryItem(
  key: RubyRegistryKey,
  kanji: string,
  type: RubyRegistryItemType
): Promise<RubyRegistryResponse> {
  return request<RubyRegistryResponse>(API_ROUTES.RUBY_REGISTRY, {
    method: 'DELETE',
    query: { ...rubyRegistryParams(key), kanji, type },
  });
}

// Only a 401 opens the key prompt: the reader shows any other failure as a page it could not analyse.
export async function prioritize(sentences: string[]): Promise<PrioritizeResponse> {
  const body: PrioritizeRequest = { sentences };
  return request<PrioritizeResponse>(API_ROUTES.PRIORITIZE, {
    method: 'POST',
    body,
    guestKey: { kind: 'gemini', promptOn: 'unauthorized' },
  });
}
