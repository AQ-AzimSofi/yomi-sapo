import { sentenceOccurrence, splitIntoSentences } from './sentences';

const IMAGE_MARKER = /\[IMAGE:([^\]]+)\]/;

export interface UnitSentence {
  text: string;
  /** Which copy of its text this sentence is, the occurrence sentenceSurroundings looks for. */
  occurrence: number;
}

export type UnitPart =
  | { kind: 'text'; text: string; sentences: readonly UnitSentence[] }
  | { kind: 'image'; name: string };

function withSentences(text: string): UnitPart {
  const sentences = splitIntoSentences(text);
  return {
    kind: 'text',
    text,
    sentences: sentences.map((sentence, index) => ({ text: sentence, occurrence: sentenceOccurrence(sentences, index) })),
  };
}

/**
 * A unit as the reader lays it out: the text runs between illustration markers,
 * blank runs dropped, and the illustrations, in order. Each run carries the
 * sentences a reader can click.
 */
export function splitUnitParts(unitText: string): UnitPart[] {
  // Splitting on a capturing pattern leaves the illustration names at the odd indexes.
  return unitText.split(IMAGE_MARKER).flatMap((piece, pieceIndex): UnitPart[] => {
    if (pieceIndex % 2 === 1) return [{ kind: 'image', name: piece }];
    if (!piece.trim()) return [];
    return [withSentences(piece)];
  });
}

export function hasIllustration(parts: readonly UnitPart[]): boolean {
  return parts.some((part) => part.kind === 'image');
}
