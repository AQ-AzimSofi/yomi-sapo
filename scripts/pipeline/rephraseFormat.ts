import { parseMarkdown as parseReaderItems } from '../../lib/utils/markdownParser';
import { isAiMetaLine } from '../../lib/utils/markdownParser/validator';
import { alignRephrase, parseRephrasePairs, type AlignReport } from '../utils/rephrase-output';
import { stripRubyTags } from './chunking';

export interface SanitizedRephrase {
  text: string;
  alignment: AlignReport;
  /** Dropped lines outside any pair that are the model talking about the task: preambles, --- separators. */
  metaLines: string[];
  /** Dropped lines outside any pair that read like book text, such as a rephrase wrapped onto a second line. */
  contentLines: string[];
  /** [IMAGE:] markers of the source that the text lost; alignment puts skipped ones back, so this should stay empty. */
  missingImageMarkers: string[];
  readerMismatches: string[];
}

const IMAGE_MARKER_GLOBAL_PATTERN = /\[IMAGE:[^\]]+\]/g;

function normalizeForCompare(text: string): string {
  return stripRubyTags(text).replace(/[\s　]/g, '');
}

/** Why a reply cannot be used as a rephrase at all, or undefined when it can. */
export function findFormatProblem(response: string): string | undefined {
  const pairs = parseRephrasePairs(response);
  if (pairs.length === 0) return 'no < / >> pair in the reply';
  const unpairedHead = pairs.find((pair) => !pair.head.trim() || pair.subItems.length === 0);
  if (!unpairedHead) return undefined;
  return `"${unpairedHead.head.slice(0, 40)}" has no >> line`;
}

/**
 * Pairs the reader would show differently from how the pipeline wrote them. The reader's
 * parseMarkdown repairs unprefixed and merged lines, so a text that reads the same through
 * both parsers is one the reader shows exactly as written.
 */
export function findReaderMismatches(text: string): string[] {
  const pipelinePairs = parseRephrasePairs(text);
  const readerItems = parseReaderItems(text);
  if (readerItems.length !== pipelinePairs.length) {
    return [`the reader reads ${readerItems.length} pair(s) where the pipeline wrote ${pipelinePairs.length}`];
  }
  return pipelinePairs.flatMap((pair, index) => {
    const readerItem = readerItems[index];
    const isSameHead = normalizeForCompare(pair.head) === normalizeForCompare(readerItem.head);
    const isSameRephraseCount = pair.subItems.length === readerItem.subItems.length;
    return isSameHead && isSameRephraseCount ? [] : [pair.head.slice(0, 60)];
  });
}

/**
 * Turns a model reply into the < / >> text the reader gets: heads rebuilt from the source,
 * skipped passages put back, and every line outside a pair dropped and sorted into model
 * chatter or lost book text for the log. `sourceText` must be free of ruby, like the text the model saw.
 */
export function sanitizeRephraseResponse(sourceText: string, response: string): SanitizedRephrase {
  const aligned = alignRephrase(sourceText, response);
  const sourceImageMarkers = sourceText.match(IMAGE_MARKER_GLOBAL_PATTERN) ?? [];
  return {
    text: aligned.text,
    alignment: aligned.report,
    metaLines: aligned.report.strayLines.filter(isAiMetaLine),
    contentLines: aligned.report.strayLines.filter((line) => !isAiMetaLine(line)),
    missingImageMarkers: sourceImageMarkers.filter((marker) => !aligned.text.includes(marker)),
    readerMismatches: findReaderMismatches(aligned.text),
  };
}
