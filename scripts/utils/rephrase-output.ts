import { isHeadingLine, isSubItemLine } from '../../lib/utils/markdownParser/validator';
import type { ParsedItem } from '../../lib/types';

export interface AlignReport {
  /** Response lines outside any < >> pair: the model talking about the task, or `---`. */
  strayLines: string[];
  /** Heads whose text differed from the source and was replaced by it. */
  restoredHeadCount: number;
  /** Source passages the model skipped, put back as original-only pairs. */
  insertedPassages: string[];
  /** Heads that matched no source passage and were kept as the model wrote them. */
  unmatchedHeads: string[];
}

interface SourceUnit {
  text: string;
  key: string;
  lineIndex: number;
}

interface SourceIndex {
  units: SourceUnit[];
  /** keyOffsets[i] is the total key length of the units before i, so a run's length is one subtraction. */
  keyOffsets: number[];
}

interface UnitRun {
  begin: number;
  end: number;
  score: number;
}

interface AlignState {
  items: ParsedItem[];
  nextUnit: number;
  hasUnmatchedSinceLastMatch: boolean;
  restoredHeadCount: number;
  insertedPassages: string[];
  unmatchedHeads: string[];
}

const IMAGE_MARKER_PATTERN = /^\[IMAGE:[^\]]+\]$/;
const CLAUSE_PATTERN = /[^。！？、]*[。！？、]+[」』）]*|[^。！？、]+$/g;
const FIGURE_SUMMARY = '（図）';
// How many source units a head may sit past the previous match; the gap is what the model skipped.
const MAX_SKIPPED_UNITS = 40;
// The model may join several sentences, or a whole paragraph, into one head; a long
// paragraph of dialogue can hold a few hundred clauses.
const MAX_RUN_UNITS = 400;
const MIN_SIMILARITY = 0.8;
// Bigram similarity says little about very short strings, so those must match exactly.
const MIN_FUZZY_LENGTH = 8;
// One passage merged or skipped beyond the window would otherwise leave every later head
// unmatched, so a head that matches nothing nearby may re-anchor further on. Only a long head
// that starts like the source and is nearly identical may do so, since short lines repeat.
const MAX_RESYNC_UNITS = 3000;
const MIN_RESYNC_SIMILARITY = 0.95;
const MIN_RESYNC_LENGTH = 20;
const RESYNC_PREFIX_LENGTH = 6;
const RESYNC_PREFIX_UNITS = 4;

/**
 * The strict reading of a rephrase reply: only < and >> lines count, with the reader's own line
 * grammar. The reader's parseMarkdown also repairs merged and unprefixed lines, which would let
 * a malformed reply through as if it were well formed.
 */
export function parseRephrasePairs(text: string): ParsedItem[] {
  const hasHeadingPrefix = /^[<＜](?!ruby>|rt>)/m.test(text);
  const hasSubItemSeparator = text.includes('>>');

  if (!hasHeadingPrefix && !hasSubItemSeparator) {
    return [];
  }

  const lines = text.split('\n');
  const items: ParsedItem[] = [];
  let currentItem: ParsedItem | null = null;
  let collectingHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collectingHeader && currentItem) {
        currentItem.head += '\n';
      }
      continue;
    }

    if (isHeadingLine(trimmed)) {
      currentItem = {
        head: trimmed.replace(/^[<＜]\s*/, ''),
        subItems: [],
      };
      items.push(currentItem);
      collectingHeader = true;
    } else if (isSubItemLine(trimmed)) {
      collectingHeader = false;
      if (currentItem) {
        currentItem.subItems.push(trimmed.replace(/^>>\s*/, ''));
      }
    } else if (collectingHeader && currentItem) {
      currentItem.head += '\n' + trimmed;
    }
  }

  return items;
}

function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000]/g, '');
}

function createRange(begin: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - begin) }, (_, offset) => begin + offset);
}

/**
 * Each source line is a paragraph, split into clauses: the model answers a paragraph, a
 * sentence or part of one per pair, and every such head is a run of whole clauses.
 */
function splitIntoUnits(sourceText: string): SourceUnit[] {
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.flatMap((line, lineIndex) => {
    const clauses = IMAGE_MARKER_PATTERN.test(line) ? [line] : (line.match(CLAUSE_PATTERN) ?? [line]);
    return clauses.map((text) => ({ text, key: normalizeForMatch(text), lineIndex }));
  });
}

function indexSource(sourceText: string): SourceIndex {
  const units = splitIntoUnits(sourceText);
  const keyOffsets = units.reduce<number[]>((offsets, unit) => {
    offsets.push(offsets[offsets.length - 1] + unit.key.length);
    return offsets;
  }, [0]);
  return { units, keyOffsets };
}

function countBigrams(text: string): Map<string, number> {
  const bigrams = createRange(0, text.length - 1).map((index) => text.slice(index, index + 2));
  return bigrams.reduce((counts, bigram) => counts.set(bigram, (counts.get(bigram) ?? 0) + 1), new Map<string, number>());
}

/** Dice coefficient over character bigrams: 1 for identical text, close to 1 when a few characters differ. */
function measureSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < MIN_FUZZY_LENGTH || b.length < MIN_FUZZY_LENGTH) return 0;
  const bigramsA = countBigrams(a);
  const bigramsB = countBigrams(b);
  const sharedCount = [...bigramsA].reduce((sum, [bigram, count]) => sum + Math.min(count, bigramsB.get(bigram) ?? 0), 0);
  return (2 * sharedCount) / (a.length - 1 + (b.length - 1));
}

function hasComparableLength(runLength: number, headLength: number): boolean {
  return Math.abs(runLength - headLength) <= Math.max(4, runLength * 0.2);
}

function joinUnitKeys(units: SourceUnit[], begin: number, end: number): string {
  return units.slice(begin, end).map((unit) => unit.key).join('');
}

/** The most similar run of source units starting at one of the candidates; ties go to the earliest run. */
function findBestRun(headKey: string, source: SourceIndex, beginCandidates: number[]): UnitRun | undefined {
  const { units, keyOffsets } = source;
  const runs = beginCandidates.flatMap((begin) =>
    createRange(begin + 1, Math.min(units.length, begin + MAX_RUN_UNITS) + 1)
      .filter((end) => hasComparableLength(keyOffsets[end] - keyOffsets[begin], headKey.length))
      .map((end) => ({ begin, end })),
  );
  return runs
    .map((run) => ({ ...run, score: measureSimilarity(headKey, joinUnitKeys(units, run.begin, run.end)) }))
    .reduce<UnitRun | undefined>((top, run) => (!top || run.score > top.score ? run : top), undefined);
}

function findResyncRun(headKey: string, source: SourceIndex, firstCandidate: number): UnitRun | undefined {
  if (headKey.length < MIN_RESYNC_LENGTH) return undefined;
  const prefix = headKey.slice(0, RESYNC_PREFIX_LENGTH);
  const lastBegin = Math.min(source.units.length, firstCandidate + MAX_RESYNC_UNITS);
  const farBegins = createRange(firstCandidate + MAX_SKIPPED_UNITS + 1, lastBegin).filter((begin) =>
    joinUnitKeys(source.units, begin, begin + RESYNC_PREFIX_UNITS).startsWith(prefix),
  );
  const best = findBestRun(headKey, source, farBegins);
  if (!best || best.score < MIN_RESYNC_SIMILARITY) return undefined;
  return best;
}

/** The run of source units a head was made from, searched forward from the first unit not yet matched. */
function findMatchingRun(headKey: string, source: SourceIndex, firstCandidate: number): UnitRun | undefined {
  const nearbyBegins = createRange(firstCandidate, Math.min(source.units.length, firstCandidate + MAX_SKIPPED_UNITS + 1));
  const nearby = findBestRun(headKey, source, nearbyBegins);
  if (nearby && nearby.score >= MIN_SIMILARITY) return nearby;
  return findResyncRun(headKey, source, firstCandidate);
}

/** Skipped units grouped back into their source lines, so a skipped paragraph returns as one pair. */
function toPassageItems(units: SourceUnit[]): ParsedItem[] {
  const lineIndexes = [...new Set(units.map((unit) => unit.lineIndex))];
  return lineIndexes.map((lineIndex) => {
    const text = units.filter((unit) => unit.lineIndex === lineIndex).map((unit) => unit.text).join('');
    const summary = IMAGE_MARKER_PATTERN.test(text) ? FIGURE_SUMMARY : text;
    return { head: text, subItems: [summary] };
  });
}

/** Clauses right before a head that end mid-sentence belong to the head's sentence, not to a pair of their own. */
function countLeadingFragments(gapUnits: SourceUnit[], headLineIndex: number): number {
  const fromHead = [...gapUnits].reverse();
  const firstWhole = fromHead.findIndex((unit) => unit.lineIndex !== headLineIndex || !unit.text.endsWith('、'));
  return firstWhole === -1 ? fromHead.length : firstWhole;
}

function alignItem(state: AlignState, item: ParsedItem, source: SourceIndex): AlignState {
  const { units } = source;
  const headKey = normalizeForMatch(item.head);
  const run = findMatchingRun(headKey, source, state.nextUnit);
  if (!run) {
    return {
      ...state,
      items: [...state.items, item],
      hasUnmatchedSinceLastMatch: true,
      unmatchedHeads: [...state.unmatchedHeads, item.head],
    };
  }
  // A gap counts as skipped only when no unmatched head since the last match could be covering it.
  const gapUnits = state.hasUnmatchedSinceLastMatch ? [] : units.slice(state.nextUnit, run.begin);
  const fragmentCount = countLeadingFragments(gapUnits, units[run.begin].lineIndex);
  const skippedItems = toPassageItems(gapUnits.slice(0, gapUnits.length - fragmentCount));
  const sourceHead = units.slice(run.begin - fragmentCount, run.end).map((unit) => unit.text).join('');
  const isRestored = normalizeForMatch(sourceHead) !== headKey;
  return {
    items: [...state.items, ...skippedItems, { head: sourceHead, subItems: item.subItems }],
    nextUnit: run.end,
    hasUnmatchedSinceLastMatch: false,
    restoredHeadCount: state.restoredHeadCount + (isRestored ? 1 : 0),
    insertedPassages: [...state.insertedPassages, ...skippedItems.map((skipped) => skipped.head)],
    unmatchedHeads: state.unmatchedHeads,
  };
}

function listStrayLines(response: string, items: ParsedItem[]): string[] {
  const pairedLines = new Set(items.flatMap((item) => [...item.head.split('\n'), ...item.subItems]).map((line) => line.trim()));
  return response
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isHeadingLine(line) && !isSubItemLine(line) && !pairedLines.has(line));
}

function formatItem(item: ParsedItem): string {
  return [`< ${item.head}`, ...item.subItems.map((subItem) => `>> ${subItem}`)].join('\n');
}

/**
 * Rebuilds a rephrase response against the text it was made from. The model's copy of each
 * original sentence can drop characters, it can skip passages (figure markers and captions
 * most of all), and it can add lines about the task. Each head is replaced by the source
 * sentences it matches, skipped passages come back as original-only pairs, and anything
 * outside a pair is dropped. `sourceText` must be free of ruby, like the text the model saw.
 */
export function alignRephrase(sourceText: string, response: string): { text: string; report: AlignReport } {
  const source = indexSource(sourceText);
  const parsedItems = parseRephrasePairs(response);
  const initialState: AlignState = {
    items: [],
    nextUnit: 0,
    hasUnmatchedSinceLastMatch: false,
    restoredHeadCount: 0,
    insertedPassages: [],
    unmatchedHeads: [],
  };
  const aligned = parsedItems.reduce((state, item) => alignItem(state, item, source), initialState);
  const trailingItems = aligned.hasUnmatchedSinceLastMatch ? [] : toPassageItems(source.units.slice(aligned.nextUnit));
  return {
    text: [...aligned.items, ...trailingItems].map(formatItem).join('\n\n'),
    report: {
      strayLines: listStrayLines(response, parsedItems),
      restoredHeadCount: aligned.restoredHeadCount,
      insertedPassages: [...aligned.insertedPassages, ...trailingItems.map((item) => item.head)],
      unmatchedHeads: aligned.unmatchedHeads,
    },
  };
}
