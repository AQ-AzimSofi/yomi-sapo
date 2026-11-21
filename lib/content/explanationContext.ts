/**
 * The passage around a sentence the reader asks the AI to explain. The reader
 * takes up to MAX_CONTEXT_SIZE characters on each side from the current page
 * when the sentence is clicked; the sidebar then trims them to the chosen
 * context size for each request.
 */

import { EXPLANATION_CONFIG } from '@/lib/constants';
import { stripFurigana } from '@/lib/utils/furiganaParser';
import { itemMainText, pageOfIndex, pageStartIndex, type ReaderItem } from './bookModel';

export interface SentenceSurroundings {
  before: string;
  after: string;
}

export const NO_SURROUNDINGS: SentenceSurroundings = { before: '', after: '' };

/** A clicked sentence: its unit, its text and, when that unit repeats it, which copy. */
export interface SentenceLocation {
  unitIndex: number;
  sentence: string;
  occurrence: number;
}

const DELIMITERS: readonly string[] = EXPLANATION_CONFIG.SENTENCE_DELIMITERS;
const IMAGE_MARKER_PATTERN = /\[IMAGE:[^\]]+\]/g;
const ENDS_WITH_IMAGE_MARKER = /\[IMAGE:[^\]]+\]$/;
const STARTS_WITH_IMAGE_MARKER = /^\[IMAGE:[^\]]+\]/;
const UNIT_SEPARATOR = '\n';

function toPlainText(text: string): string {
  return stripFurigana(text).replace(IMAGE_MARKER_PATTERN, '');
}

// Counted in code points, so a kanji outside the basic plane is never cut in half.
function lastChars(text: string, count: number): string {
  if (count <= 0) return '';
  return Array.from(text).slice(-count).join('');
}

function firstChars(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

function startsOfCopies(text: string, search: string): number[] {
  const pieces = text.split(search);
  return pieces.slice(0, -1).map((_, copyIndex) => pieces.slice(0, copyIndex + 1).join(search).length);
}

// The reader cuts a unit into sentences after each delimiter and around each
// illustration, then trims them, so a clicked sentence starts and ends at one of
// those cuts. A copy anywhere else is only part of a longer sentence.
function isWholeSentenceAt(text: string, sentence: string, start: number): boolean {
  const textBefore = text.slice(0, start).trimEnd();
  const startsSentence =
    textBefore === '' || DELIMITERS.some((delimiter) => textBefore.endsWith(delimiter)) || ENDS_WITH_IMAGE_MARKER.test(textBefore);
  if (!startsSentence) return false;
  if (DELIMITERS.some((delimiter) => sentence.endsWith(delimiter))) return true;
  const textAfter = text.slice(start + sentence.length).trimStart();
  return textAfter === '' || STARTS_WITH_IMAGE_MARKER.test(textAfter);
}

function locateSentence(unitText: string, { sentence, occurrence }: SentenceLocation): number {
  if (!sentence) return -1;
  const sentenceStarts = startsOfCopies(unitText, sentence).filter((start) => isWholeSentenceAt(unitText, sentence, start));
  return sentenceStarts[occurrence] ?? -1;
}

function plainUnitTexts(items: readonly ReaderItem[]): string[] {
  return items.map((item) => toPlainText(itemMainText(item)).trim()).filter((text) => text !== '');
}

/** The current page's text on each side of the clicked sentence, without furigana or illustrations. */
export function sentenceSurroundings(items: readonly ReaderItem[], location: SentenceLocation): SentenceSurroundings {
  const unit = items[location.unitIndex];
  if (!unit) return NO_SURROUNDINGS;
  const unitText = itemMainText(unit);
  const sentenceStart = locateSentence(unitText, location);
  if (sentenceStart === -1) return NO_SURROUNDINGS;

  const page = pageOfIndex(location.unitIndex);
  const unitsBefore = plainUnitTexts(items.slice(pageStartIndex(page), location.unitIndex));
  const unitsAfter = plainUnitTexts(items.slice(location.unitIndex + 1, pageStartIndex(page + 1)));
  const unitTextBefore = toPlainText(unitText.slice(0, sentenceStart)).trimStart();
  const unitTextAfter = toPlainText(unitText.slice(sentenceStart + location.sentence.length)).trimEnd();
  const textBefore = [...unitsBefore, unitTextBefore].join(UNIT_SEPARATOR);
  const textAfter = [unitTextAfter, ...unitsAfter].join(UNIT_SEPARATOR);
  return {
    before: lastChars(textBefore, EXPLANATION_CONFIG.MAX_CONTEXT_SIZE),
    after: firstChars(textAfter, EXPLANATION_CONFIG.MAX_CONTEXT_SIZE),
  };
}

interface ExplanationContextInput {
  sentence: string;
  surroundings: SentenceSurroundings;
  contextSize: number;
}

/**
 * The passage sent with an explanation request: contextSize characters on each
 * side of the sentence, with the sentence in its place. A sentence with nothing
 * around it gets no context, so the prompt never repeats the sentence alone.
 */
export function buildExplanationContext({ sentence, surroundings, contextSize }: ExplanationContextInput): string {
  const before = lastChars(surroundings.before, contextSize);
  const after = firstChars(surroundings.after, contextSize);
  if (before.trim() === '' && after.trim() === '') return '';
  return `${before}${toPlainText(sentence).trim()}${after}`;
}
