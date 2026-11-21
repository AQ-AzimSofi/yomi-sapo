/**
 * よみサポアプリケーションのコア型定義
 */

// AI生成のマークダウンから解析されたアイテム構造
export interface ParsedItem {
  head: string;       // 元の日本語テキスト（プレフィックスなし）
  subItems: string[]; // 言い換えバージョンの配列
}

// オーディオブックの再生単位（本全体を通した連番つき）
export interface PlayableUnit {
  globalIndex: number;
  main: string;
  sub: string | null;
}

// オーディオブックで読み上げる対象
export type AudioBookContentMode = 'main' | 'sub' | 'both';

// 朗読音源の再生区間（秒）
export interface NarrationCue {
  start: number;
  end: number;
}

// 朗読音源のマニフェスト。cues の添字は PlayableUnit.globalIndex と一致し、
// 音源が対応していないユニットは null（TTSにフォールバックする）
//
// unitCount は生成時の本文のユニット数。読み込み側は「本文がこれより長い」場合だけ
// 弾く（段落が増えた ＝ 以降の添字が全部ずれる）。短い場合は先頭からの一部とみなして
// 受け入れる（ゲストプレビューがこの形）。同じ長さの編集と段落削除は検出できない。
export interface NarrationManifest {
  audioUrl: string;
  unitCount: number;
  cues: (NarrationCue | null)[];
}

// Book metadata types (from EPUB converter JSON)
export interface BookImage {
  fileName: string;          // e.g., "illustration-001.jpg"
  imagePath: string;         // Full path to image file
  orderIndex: number;        // Order in the book
  originalName: string;      // Original name in EPUB (e.g., "image/k001.jpg")
  altText: string | null;    // Alt text for accessibility
}

export interface ProcessingHistory {
  filterMode: string;        // "all" or "n3"
  hiraganaStyle: string;     // "full" or "long-vowel"
  chaptersCount: number;     // Number of chapters
  fileSize: number;          // File size in KB
  imageCount: number;        // Number of images
}

export interface BookMetadata {
  title: string;
  author: string;
  fileName: string;
  textFilePath: string;
  originalEpubName: string;
  processingHistory: ProcessingHistory;
  images: BookImage[];
}

// Image mapping: original name (without "image/" prefix) → actual filename
export type ImageMap = Record<string, string>;

// 説明キャッシュ型
export interface CachedExplanation {
  sentence: string;
  // The passage sent with the request. Missing on entries saved before it was
  // stored, which were made from the sentence alone.
  context?: string;
  explanation: string;
  contextSize: number;
  // Missing on entries saved before explanation modes existed.
  mode?: import('./constants').ExplanationMode;
  // When the answer was requested, so a late answer never replaces a newer one.
  timestamp: number;
}

export interface ExplanationCache {
  [key: string]: CachedExplanation;
}

// 単語帳APIが返すエントリ。日時はJSONを通るのでISO 8601の文字列
export interface VocabularyEntry {
  id: string;
  word: string;
  reading: string | null;
  sentence: string;
  fileName: string;
  directory: string;
  paragraphText: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Ruby Registry types (for character name lookups)
export interface RubyEntry {
  kanji: string;
  reading: string;
  source: 'epub' | 'user';
  note: string;
}

export interface RubySuggestion {
  kanji: string;
  occurrences: number;
}

export interface RubyRegistry {
  bookTitle: string;
  entries: RubyEntry[];
  suggestions: RubySuggestion[];
}
