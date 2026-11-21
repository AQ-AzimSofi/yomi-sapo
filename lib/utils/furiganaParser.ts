/**
 * 振り仮名パーサー
 * 2つの形式をサポート:
 * 1. 漢字[ふりがな] - ブラケット形式
 * 2. <ruby>漢字<rt>ふりがな</rt></ruby> - HTML ruby形式
 */

import { escapeHtml } from './html';

// Some books mark footnotes with <sup>; only the bare tag is let through.
const ESCAPED_FOOTNOTE_TAG = /&lt;(\/?)sup&gt;/g;

const RUBY_ELEMENT_PATTERN = /<ruby>(.*?)<\/ruby>/g;
// One ruby element may hold several base/reading pairs: 幼<rt>おさな</rt>馴<rt>な</rt>.
const RUBY_PAIR_PATTERN = /(?:<rb>)?([^<]+)(?:<\/rb>)?<rt>([^<]*)<\/rt>/g;
// <rp> holds the parentheses shown by browsers without ruby support.
const RUBY_FALLBACK_PATTERN = /<rp>[^<]*<\/rp>/g;
// The base is the kanji run right before the bracket and the reading is kana,
// so notes such as [IMAGE:...] are never read as furigana.
const BRACKET_FURIGANA_PATTERN = /([㐀-䶿一-鿿々〆ヶ]+)\[([ぁ-ゖァ-ヺー]+)\]/g;
const TAG_PATTERN = /<[^>]*>/g;
// AI explanations put a reading after any word (難しい[むずかしい]), not only after kanji.
const AI_READING_PATTERN = /\[[ぁ-ゖー]+\](?!\()/g;

function escapeBookText(text: string): string {
  return escapeHtml(text).replace(ESCAPED_FOOTNOTE_TAG, '<$1sup>');
}

export interface FuriganaSegment {
  type: 'text' | 'ruby';
  text: string;
  ruby?: string;
}

interface SplitByMatchesOptions {
  text: string;
  pattern: RegExp;
  parseGap: (gap: string) => FuriganaSegment[];
  parseMatch: (match: RegExpMatchArray) => FuriganaSegment[];
}

function splitByMatches({ text, pattern, parseGap, parseMatch }: SplitByMatchesOptions): FuriganaSegment[] {
  const matches = [...text.matchAll(pattern)];
  const matchEnds = matches.map((match) => (match.index ?? 0) + match[0].length);
  const segmentsThroughLastMatch = matches.flatMap((match, matchIndex) => [
    ...parseGap(text.slice(matchIndex === 0 ? 0 : matchEnds[matchIndex - 1], match.index)),
    ...parseMatch(match),
  ]);
  return [...segmentsThroughLastMatch, ...parseGap(text.slice(matchEnds.at(-1) ?? 0))];
}

function textSegments(text: string): FuriganaSegment[] {
  return text ? [{ type: 'text', text }] : [];
}

function parseRubyElement(match: RegExpMatchArray): FuriganaSegment[] {
  return splitByMatches({
    text: match[1].replace(RUBY_FALLBACK_PATTERN, ''),
    pattern: RUBY_PAIR_PATTERN,
    parseGap: (gap) => textSegments(gap.replace(TAG_PATTERN, '')),
    parseMatch: ([, base, reading]) => [{ type: 'ruby', text: base, ruby: reading }],
  });
}

function parseBracketFurigana(text: string): FuriganaSegment[] {
  if (!text.includes('[')) return textSegments(text);
  return splitByMatches({
    text,
    pattern: BRACKET_FURIGANA_PATTERN,
    parseGap: textSegments,
    parseMatch: ([, base, reading]) => [{ type: 'ruby', text: base, ruby: reading }],
  });
}

/**
 * テキストを振り仮名セグメントに解析
 * @param text 解析するテキスト
 * @returns セグメントの配列
 */
export function parseFurigana(text: string): FuriganaSegment[] {
  // Bracket readings are only looked for between ruby elements, never across them.
  const segments = splitByMatches({
    text,
    pattern: RUBY_ELEMENT_PATTERN,
    parseGap: parseBracketFurigana,
    parseMatch: parseRubyElement,
  });
  return segments.length > 0 ? segments : [{ type: 'text', text }];
}

/**
 * 振り仮名セグメントをHTML文字列に変換
 * @param segments セグメントの配列
 * @param showFurigana 振り仮名を表示するかどうか
 * @returns HTML文字列
 */
export function segmentsToHTML(segments: FuriganaSegment[], showFurigana: boolean): string {
  return segments
    .map(segment => {
      if (segment.type === 'ruby' && showFurigana && segment.ruby) {
        return `<ruby>${escapeBookText(segment.text)}<rt>${escapeHtml(segment.ruby)}</rt></ruby>`;
      }
      return escapeBookText(segment.text);
    })
    .join('');
}

/**
 * テキストから振り仮名を完全に除去（プレーンテキストのみ返す）
 * @param text 元のテキスト
 * @returns 振り仮名表記を除去したプレーンテキスト
 */
export function stripFurigana(text: string): string {
  const segments = parseFurigana(text);
  return segments.map(s => s.text).join('');
}

export function stripAiFurigana(text: string): string {
  return stripFurigana(text).replace(AI_READING_PATTERN, '');
}
