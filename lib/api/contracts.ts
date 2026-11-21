/**
 * Request and response bodies of the API routes the browser calls. Route handlers
 * type their responses with these and lib/api/client.ts reads them, so both sides
 * share one definition. Types only, so the module is safe to import anywhere.
 */
import type { ExplanationMode, TTSVoiceGender } from '@/lib/constants';
import type { RubyRegistry, VocabularyEntry } from '@/lib/types';

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
  | 'internal_error';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
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

// /api/ruby-registry
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
