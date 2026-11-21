import { EXPLANATION_CONFIG } from '@/lib/constants';

const DELIMITERS = EXPLANATION_CONFIG.SENTENCE_DELIMITERS.join('');
// Each piece runs up to and including the next delimiter; the last takes whatever is left.
const SENTENCE_PIECE = new RegExp(`[^${DELIMITERS}]*[${DELIMITERS}]|[^${DELIMITERS}]+$`, 'g');

/**
 * The sentences the reader shows for clicking: the text cut after each
 * delimiter, each piece trimmed and empty ones dropped. sentenceSurroundings
 * finds a clicked sentence in its unit by these same cuts.
 */
export function splitIntoSentences(text: string): string[] {
  const pieces = text.match(SENTENCE_PIECE) ?? [];
  return pieces.map((piece) => piece.trim()).filter((sentence) => sentence.length > 0);
}

/** Which copy of its text the sentence at this index is, counting the same text earlier in the list. */
export function sentenceOccurrence(sentences: readonly string[], index: number): number {
  const sentence = sentences[index];
  return sentences.slice(0, index).filter((earlier) => earlier === sentence).length;
}
