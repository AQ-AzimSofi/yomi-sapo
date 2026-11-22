import { isHeadingLine } from '../../lib/utils/markdownParser/validator';
import { CHUNK_SEPARATOR } from './chunkFiles';
import { normalizeForCompare } from './rephraseFormat';

interface HeadLine {
  offset: number;
  text: string;
}

const HEAD_PREFIX_PATTERN = /^[<＜]\s*/;
// Main's furigana step wrote every line break in a chunk as CRLF on Windows, and main appended
// each chunk after CHUNK_SEPARATOR, so a separator with no CR before it is a chunk boundary.
const BARE_SEPARATOR_PATTERN = /(?<!\r)\n\n/;
const BARE_LINE_BREAK_PATTERN = /(?<!\r)\n/;
// alignRephrase put the source back in every head close to it, so nearly all of a chunk comes
// back in heads found in it word for word; a piece of another chunk holds next to none.
const MIN_VERBATIM_HEAD_SHARE = 0.5;

function findHeadLines(text: string): HeadLine[] {
  return [...text.matchAll(/^[^\n]*/gm)]
    .filter((match) => isHeadingLine(match[0].trim()))
    .map((match) => ({ offset: match.index, text: normalizeForCompare(match[0].trim().replace(HEAD_PREFIX_PATTERN, '')) }));
}

// startOffsets[i] is the total length of the texts before text i.
function listStartOffsets(texts: readonly string[]): number[] {
  return texts.reduce<number[]>((offsets, text) => {
    offsets.push(offsets[offsets.length - 1] + text.length);
    return offsets;
  }, [0]).slice(0, texts.length);
}

// A chunk starts after the last append separator before its first head, so a model preamble
// such as 以下が要約です。 stays with its own chunk.
function findChunkStart(text: string, headLines: readonly HeadLine[], firstHeadIndex: number): number | undefined {
  if (firstHeadIndex === 0) return 0;
  const firstHeadOffset = headLines[firstHeadIndex].offset;
  const separatorOffset = text.lastIndexOf(CHUNK_SEPARATOR, firstHeadOffset - CHUNK_SEPARATOR.length);
  if (separatorOffset <= headLines[firstHeadIndex - 1].offset) return undefined;
  return separatorOffset + CHUNK_SEPARATOR.length;
}

/**
 * Splits an output the pipeline built by appending chunk after chunk back into one text per
 * chunk. The < heads, read without ruby or spaces, must hold exactly the chunks' source text in
 * order, whether each head is a source line (Claude) or a sentence or a run of them (Gemini,
 * after alignRephrase). A chunk starts at the head where the heads before it hold exactly the
 * chunks before it, after an append separator that follows the head before. Otherwise the text
 * is not that sequence of chunks and undefined is returned.
 */
export function splitByChunkText(text: string, chunks: readonly string[]): string[] | undefined {
  const headLines = findHeadLines(text);
  const headTexts = headLines.map((headLine) => headLine.text);
  const chunkTexts = chunks.map(normalizeForCompare);
  // A chunk without text would have no head to start at.
  if (chunkTexts.includes('')) return undefined;
  if (headTexts.join('') !== chunkTexts.join('')) return undefined;
  if (chunks.length === 0) return text === '' ? [] : undefined;

  const headStartOffsets = listStartOffsets(headTexts);
  const firstHeadIndexes = listStartOffsets(chunkTexts).map((chunkOffset) => headStartOffsets.indexOf(chunkOffset));
  if (firstHeadIndexes.includes(-1)) return undefined;
  const chunkStarts = firstHeadIndexes.map((headIndex) => findChunkStart(text, headLines, headIndex));
  if (chunkStarts.includes(undefined)) return undefined;

  const outputChunks = chunkStarts.map((start, chunkIndex) => {
    const nextStart = chunkStarts[chunkIndex + 1];
    return text.slice(start, nextStart === undefined ? text.length : nextStart - CHUNK_SEPARATOR.length);
  });
  if (outputChunks.join(CHUNK_SEPARATOR) !== text) throw new Error('splitByChunkText lost text while splitting an output');
  return outputChunks;
}

function holdsMostOfChunk(piece: string, chunk: string): boolean {
  const chunkText = normalizeForCompare(chunk);
  const verbatimHeadLength = findHeadLines(piece)
    .filter((headLine) => chunkText.includes(headLine.text))
    .reduce((total, headLine) => total + headLine.text.length, 0);
  return verbatimHeadLength > chunkText.length * MIN_VERBATIM_HEAD_SHARE;
}

/**
 * Splits a reader file main's pipeline wrote on Windows at the bare separators it appended each
 * chunk after. Unlike splitByChunkText, it still splits when main kept a head Gemini reworded too
 * far for alignRephrase to restore. Undefined unless there is one piece per chunk, no bare line
 * break is left in a piece (a chunk whose furigana step failed has them), and most of each
 * chunk's text is in its piece's heads word for word, which a chunk appended twice is not.
 */
export function splitByChunkSeparators(text: string, chunks: readonly string[]): string[] | undefined {
  const pieces = text.split(BARE_SEPARATOR_PATTERN);
  if (pieces.length !== chunks.length) return undefined;
  if (pieces.some((piece) => BARE_LINE_BREAK_PATTERN.test(piece))) return undefined;
  return pieces.every((piece, index) => holdsMostOfChunk(piece, chunks[index])) ? pieces : undefined;
}
