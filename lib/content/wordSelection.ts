/**
 * A word the reader selected, turned into the 単語帳 entry it saves. The reader
 * passes what it shows (text without furigana); the furigana and the sentence
 * come from the stored unit text, so they are there whether furigana is shown or not.
 */

import { parseFurigana, stripFurigana } from '@/lib/utils/furiganaParser';
import { splitUnitParts } from './unitParts';

export const MAX_WORD_LENGTH = 30;

const LINE_BREAK = /[\r\n]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
// The reader renders footnote tags as markup, so their text never shows.
const FOOTNOTE_TAG = /<\/?sup>/g;
const IMAGE_MARKER = /\[IMAGE:[^\]]+\]/g;

/** A selection inside one reading item, as the reader shows it: no furigana. */
export interface ShownSelection {
  selectedText: string;
  /** The item's text from its start up to the selection. */
  textBefore: string;
}

export interface WordDraft {
  word: string;
  /** The furigana when the word is exactly one or more whole ruby words, else empty. */
  reading: string;
  /** The sentence the word sits in (every one it runs across), with its furigana as the book writes it. */
  sentence: string;
  /** The whole unit without furigana or illustrations. */
  paragraphText: string;
}

interface ShownPiece {
  text: string;
  reading: string | null;
  sentenceIndex: number;
  start: number;
}

function isSavableWord(word: string): boolean {
  const length = Array.from(word).length;
  return length >= 1 && length <= MAX_WORD_LENGTH && !LINE_BREAK.test(word) && LETTER_OR_DIGIT.test(word);
}

/** Where each copy of `search` starts, overlapping copies included. */
function copyStarts(text: string, search: string): number[] {
  const lastStart = text.length - search.length;
  return Array.from({ length: Math.max(0, lastStart + 1) }, (_, start) => start).filter((start) =>
    text.startsWith(search, start)
  );
}

// The reader shows a unit as its sentences, each one's furigana segments in order.
function shownPieces(sentences: readonly string[]): ShownPiece[] {
  const pieces = sentences.flatMap((sentence, sentenceIndex) =>
    parseFurigana(sentence).map((segment) => ({
      text: segment.text.replace(FOOTNOTE_TAG, ''),
      reading: segment.type === 'ruby' ? segment.ruby || null : null,
      sentenceIndex,
    }))
  );
  return pieces.map((piece, pieceIndex) => ({
    ...piece,
    start: pieces.slice(0, pieceIndex).reduce((length, earlier) => length + earlier.text.length, 0),
  }));
}

function wholeRubyReading(covered: readonly ShownPiece[], start: number, end: number): string {
  const first = covered[0];
  const last = covered[covered.length - 1];
  const coversWholePieces = first.start === start && last.start + last.text.length === end;
  if (!coversWholePieces) return '';
  if (!covered.every((piece) => piece.reading)) return '';
  return covered.map((piece) => piece.reading).join('');
}

/**
 * The entry a selection saves, or null when it is no word to save: blank, longer
 * than MAX_WORD_LENGTH, across a line break, only punctuation, or text the unit
 * does not hold (such as its translation). The selected copy is found by counting
 * the copies shown before it, so a word repeated in the unit is saved from its own sentence.
 */
export function wordDraftFor(unitText: string, { selectedText, textBefore }: ShownSelection): WordDraft | null {
  const word = selectedText.trim();
  if (!isSavableWord(word)) return null;

  const leadingSpace = selectedText.slice(0, selectedText.length - selectedText.trimStart().length);
  const shownBefore = textBefore + leadingSpace;
  const copyIndex = copyStarts(shownBefore + word, word).filter((start) => start < shownBefore.length).length;

  const sentences = splitUnitParts(unitText).flatMap((part) =>
    part.kind === 'text' ? part.sentences.map((sentence) => sentence.text) : []
  );
  const pieces = shownPieces(sentences);
  const start = copyStarts(pieces.map((piece) => piece.text).join(''), word)[copyIndex];
  if (start === undefined) return null;

  const end = start + word.length;
  const covered = pieces.filter((piece) => piece.start < end && piece.start + piece.text.length > start);
  const firstSentence = covered[0].sentenceIndex;
  const lastSentence = covered[covered.length - 1].sentenceIndex;
  return {
    word,
    reading: wholeRubyReading(covered, start, end),
    sentence: sentences.slice(firstSentence, lastSentence + 1).join(''),
    paragraphText: stripFurigana(unitText.replace(IMAGE_MARKER, '')).trim(),
  };
}
