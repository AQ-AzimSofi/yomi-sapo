import { sentenceOccurrence, splitIntoSentences } from './sentences';

const IMAGE_MARKER = /\[IMAGE:([^\]]+)\]/;

export interface UnitSentence {
  text: string;
  /** Which copy of its text in the unit this sentence is, the occurrence sentenceSurroundings looks for. */
  occurrence: number;
}

export type UnitPart =
  | { kind: 'text'; text: string; sentences: readonly UnitSentence[] }
  | { kind: 'image'; name: string };

type LayoutPiece = { kind: 'text'; text: string } | { kind: 'image'; name: string };

function layoutPieces(unitText: string): LayoutPiece[] {
  // Splitting on a capturing pattern leaves the illustration names at the odd indexes.
  return unitText.split(IMAGE_MARKER).flatMap((piece, pieceIndex): LayoutPiece[] => {
    if (pieceIndex % 2 === 1) return [{ kind: 'image', name: piece }];
    if (!piece.trim()) return [];
    return [{ kind: 'text', text: piece }];
  });
}

/**
 * A unit as the reader lays it out: the text runs between illustration markers,
 * blank runs dropped, and the illustrations, in order. Each run carries the
 * sentences a reader can click, each numbered among the copies of its text in the
 * whole unit, as sentenceSurroundings counts them.
 */
export function splitUnitParts(unitText: string): UnitPart[] {
  const pieces = layoutPieces(unitText);
  const sentencesByPiece = pieces.map((piece) => (piece.kind === 'text' ? splitIntoSentences(piece.text) : []));
  const unitSentences = sentencesByPiece.flat();
  const firstSentenceIndexByPiece = sentencesByPiece.map((_, pieceIndex) => sentencesByPiece.slice(0, pieceIndex).flat().length);
  return pieces.map((piece, pieceIndex) => {
    if (piece.kind === 'image') return piece;
    return {
      ...piece,
      sentences: sentencesByPiece[pieceIndex].map((sentence, index) => ({
        text: sentence,
        occurrence: sentenceOccurrence(unitSentences, firstSentenceIndexByPiece[pieceIndex] + index),
      })),
    };
  });
}

export function hasIllustration(parts: readonly UnitPart[]): boolean {
  return parts.some((part) => part.kind === 'image');
}
