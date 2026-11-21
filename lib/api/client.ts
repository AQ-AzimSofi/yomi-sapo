/**
 * The browser's one way to call the app's API routes. URLs come from API_ROUTES,
 * a response outside 2xx becomes an ApiError, and paid routes carry the guest's
 * own key. Browser-safe: nothing here may import server-only code.
 */
import { API_ROUTES } from '@/lib/constants';
import { guestKeyHeaders, promptGuestKeyOnFailure, type GuestKeyKind } from '@/lib/guestKeys';
import { isRecord } from '@/lib/utils/typeGuards';
import type { BookRef } from '@/lib/books/bookRef';
import type { ApiErrorResponse, BookmarkResponse, SaveBookmarkRequest, WriteResponse } from './contracts';

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

async function promptForGuestKey(guestKey: GuestKeyUse, response: Response): Promise<boolean> {
  if (guestKey.promptOn === 'unauthorized' && response.status !== 401) return false;
  return promptGuestKeyOnFailure(guestKey.kind, response);
}

async function toApiError(response: Response, guestKey: GuestKeyUse | undefined): Promise<ApiError> {
  const promptedGuestKey = guestKey ? await promptForGuestKey(guestKey, response.clone()) : false;
  const body = await readErrorBody(response);
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

/** The saved bookmark, or null when the server gives none (guests have no bookmarks). */
export async function fetchBookmark(book: BookRef, signal?: AbortSignal): Promise<BookmarkResponse | null> {
  return request<BookmarkResponse>(API_ROUTES.READ_BOOKMARK, { query: bookParams(book), signal }).catch(nullOnApiError);
}

export async function saveBookmark(bookmark: SaveBookmarkRequest): Promise<WriteResponse> {
  return request<WriteResponse>(API_ROUTES.WRITE_BOOKMARK, { method: 'POST', body: bookmark });
}
