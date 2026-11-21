/**
 * Request and response bodies of the API routes the browser calls. Route handlers
 * type their responses with these and lib/api/client.ts reads them, so both sides
 * share one definition. Types only, so the module is safe to import anywhere.
 */
import type { ExplanationMode, PriorityScore, TTSVoiceGender } from '@/lib/constants';
import type { BookRef } from '@/lib/books/bookRef';
import type { GuestKeyKind } from '@/lib/guestKeys';
import type { RubyEntry, RubyRegistry, VocabularyEntry } from '@/lib/types';
import type { DiffResult, SyncResult } from '@/lib/db/sync-core';

export type { DiffResult, SyncResult };

export type ApiErrorCode =
  | 'invalid_json'
  | 'invalid_body'
  | 'invalid_request'
  | 'invalid_password'
  | 'sign_in_required'
  | 'admin_key_required'
  | 'guest_key_required'
  | 'preview_only'
  | 'not_found'
  | 'not_configured'
  | 'upstream_failed'
  | 'upstream_timeout'
  | 'text_too_large'
  | 'internal_error';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/**
 * A failed response as the client reads it. A guest's 401 from a paid route adds
 * the key it needs; login and the vocabulary list repeat the message at the top level.
 */
export interface ApiErrorResponse extends Partial<ApiErrorBody> {
  requiresGuestKey?: GuestKeyKind;
  message?: string;
}

// /api/auth?action=login
export interface LoginRequest {
  password: string;
}

// /api/auth?action=login and ?action=logout
export interface AuthResponse {
  success: true;
  message: string;
}

// /api/auth?action=session
export interface SessionResponse {
  authenticated: boolean;
}

// /api/read-public-txt
export interface BookTextResponse {
  text: string;
}

// /api/read-bookmark
export interface BookmarkResponse {
  text: string;
  // The reader page the bookmark was saved on; it tells repeated text apart.
  page?: number | null;
}

// /api/write-bookmark
export interface SaveBookmarkRequest extends BookRef {
  content: string;
  page?: number;
}

export interface WriteResponse {
  success?: boolean;
  message: string;
}

// /api/list-text-files
export interface TextFileListResponse {
  directories: string[];
  filesByDirectory: Record<string, string[]>;
  // Every book as its "directory/fileName" key.
  files: string[];
}

// /api/library-progress
export interface LibraryBookProgress {
  progress: number;
  totalCharacters: number;
  bookmarkPage: number | null;
  totalPages: number;
  bookmarkUpdatedAt: string | null;
  createdAt: string | null;
}

// Keyed by the book key "directory/fileName".
export type LibraryProgressResponse = Record<string, LibraryBookProgress>;

// /api/explain-sentence
export interface ExplanationRequest {
  sentence: string;
  context: string;
  fileName: string;
  contextSize: number;
  mode: ExplanationMode;
}

export interface ExplanationResponse {
  explanation: string;
  message: string;
}

// /api/prioritize
export interface PrioritizeRequest {
  sentences: string[];
}

export interface PrioritizeResponse {
  scores: PriorityScore[];
}

// /api/translate
export interface TranslateRequest {
  text: string;
  targetLanguage?: string;
}

export interface TranslateResponse {
  translatedText: string;
}

// /api/tts
export interface TTSRequest {
  text: string;
  speed?: number;
  voiceGender?: TTSVoiceGender;
}

export interface TTSResponse {
  audioContent: string; // base64エンコードされた音声データ
  message: string;
}

// /api/narration answers a NarrationManifest and /api/book-assets serves a book's
// BookMetadata JSON, both defined in lib/types.

// /api/ruby-registry
export interface RubyRegistryKey {
  directory: string;
  bookName: string;
}

export interface RubyEntryDraft {
  kanji: string;
  reading: string;
  source?: RubyEntry['source'];
  note?: string;
}

export interface SaveRubyEntryRequest extends RubyRegistryKey {
  entry: RubyEntryDraft;
}

// DELETE removes an entry, or ignores a suggestion so it is not offered again.
export type RubyRegistryItemType = 'entry' | 'suggestion';

export interface RubyRegistryResponse {
  success: boolean;
  registry?: RubyRegistry;
  message: string;
}

// /api/vocabulary
export interface VocabularyListResponse {
  success: true;
  entries: VocabularyEntry[];
  count: number;
}

// /api/vocabulary/[id]
export interface VocabularyEntryResponse {
  success: true;
  message?: string;
  entry: VocabularyEntry;
}

export interface DeleteVocabularyResponse {
  success: true;
  message: string;
}

// /api/db-sync
export type DbSyncDirection = 'pull' | 'push' | 'full';

export interface DbSyncRequest {
  direction: DbSyncDirection;
}

export interface DbSyncStatusResponse {
  diffs: DiffResult[];
}

export interface DbSyncResponse {
  success: true;
  results: SyncResult[];
}
