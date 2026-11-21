import { isHeadingLine } from '../../lib/utils/markdownParser/validator';
import { splitParagraphs } from '../utils/claude-rephrase';
import { CHUNK_SEPARATOR } from './chunkFiles';
import { stripRubyTags } from './chunking';
import { normalizeForCompare } from './rephraseFormat';

interface HeadLine {
  offset: number;
  text: string;
}

const HEAD_PREFIX_PATTERN = /^[<＜]\s*/;

function findHeadLines(text: string): HeadLine[] {
  return [...text.matchAll(/^[^\n]*/gm)]
    .filter((match) => isHeadingLine(match[0].trim()))
    .map((match) => ({ offset: match.index, text: normalizeForCompare(match[0].trim().replace(HEAD_PREFIX_PATTERN, '')) }));
}

/** The < heads a chunk's rephrase holds: one per source line, as the furigana step and the reader compare them. */
export function listExpectedHeads(chunk: string): string[] {
  return splitParagraphs(stripRubyTags(chunk)).map(normalizeForCompare);
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
 * chunk. Every < head must match its chunk's source line in order, and an append separator must
 * come between each chunk's first head and the head before it; otherwise the text is not that
 * sequence of chunks and undefined is returned.
 */
export function splitByChunkHeads(text: string, expectedHeadsByChunk: readonly string[][]): string[] | undefined {
  const headLines = findHeadLines(text);
  const expectedHeads = expectedHeadsByChunk.flat();
  if (headLines.length !== expectedHeads.length) return undefined;
  if (headLines.some((headLine, headIndex) => headLine.text !== expectedHeads[headIndex])) return undefined;
  if (expectedHeadsByChunk.length === 0) return text === '' ? [] : undefined;

  const firstHeadIndexes = expectedHeadsByChunk.map((_, chunkIndex) => expectedHeadsByChunk.slice(0, chunkIndex).flat().length);
  const chunkStarts = firstHeadIndexes.map((headIndex) => findChunkStart(text, headLines, headIndex));
  if (chunkStarts.includes(undefined)) return undefined;

  const chunkTexts = chunkStarts.map((start, chunkIndex) => {
    const nextStart = chunkStarts[chunkIndex + 1];
    return text.slice(start, nextStart === undefined ? text.length : nextStart - CHUNK_SEPARATOR.length);
  });
  if (chunkTexts.join(CHUNK_SEPARATOR) !== text) throw new Error('splitByChunkHeads lost text while splitting an output');
  return chunkTexts;
}
