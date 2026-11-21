import { describe, expect, it } from 'vitest';
import { listExpectedHeads, splitByChunkHeads } from './legacyOutputSplit';

const CHUNK_0 = '<ruby>猫<rt>ねこ</rt></ruby>がいる。\n◆';
const CHUNK_1 = '◆\n犬もいる。';
const EXPECTED_HEADS = [listExpectedHeads(CHUNK_0), listExpectedHeads(CHUNK_1)];
// The furigana step writes CRLF on Windows and drops spaces; chunks were appended after a plain blank line.
const FURIGANA_0 = '< <ruby>猫<rt>ねこ</rt></ruby>がいる。\r\n>> 猫が います。\r\n\r\n< ◆\r\n>> ◆';
const FURIGANA_1 = '< ◆\r\n>> ◆\r\n\r\n< <ruby>犬<rt>いぬ</rt></ruby>もいる。\r\n>> 犬も います。';

describe('listExpectedHeads', () => {
  it('Test_listExpectedHeads_OnePerSourceLineWithoutRubyOrSpaces', () => {
    expect(listExpectedHeads('<ruby>猫<rt>ねこ</rt></ruby> が\n\n いる ')).toEqual(['猫が', 'いる']);
  });
});

describe('splitByChunkHeads', () => {
  it('Test_splitByChunkHeads_SplitsAppendedChunks', () => {
    expect(splitByChunkHeads(`${FURIGANA_0}\n\n${FURIGANA_1}`, EXPECTED_HEADS)).toEqual([FURIGANA_0, FURIGANA_1]);
  });

  it('Test_splitByChunkHeads_LineRepeatedAcrossChunksSplitsByCount', () => {
    const [first] = splitByChunkHeads(`${FURIGANA_0}\n\n${FURIGANA_1}`, EXPECTED_HEADS) ?? [];
    expect(first.endsWith('< ◆\r\n>> ◆')).toBe(true);
  });

  it('Test_splitByChunkHeads_ExtraChunkIsNotASplit', () => {
    expect(splitByChunkHeads(`${FURIGANA_0}\n\n${FURIGANA_1}`, EXPECTED_HEADS.slice(0, 1))).toBeUndefined();
  });

  it('Test_splitByChunkHeads_DifferentHeadIsNotASplit', () => {
    expect(splitByChunkHeads(FURIGANA_0.replace('がいる', 'はいない'), EXPECTED_HEADS.slice(0, 1))).toBeUndefined();
  });

  it('Test_splitByChunkHeads_TextBeforeAChunkStartIsNotASplit', () => {
    expect(splitByChunkHeads(`${FURIGANA_0}\n\n以下が要約です。\n${FURIGANA_1}`, EXPECTED_HEADS)).toBeUndefined();
  });

  it('Test_splitByChunkHeads_NoChunkMatchesOnlyEmptyText', () => {
    expect(splitByChunkHeads('', [])).toEqual([]);
    expect(splitByChunkHeads('以下が要約です。', [])).toBeUndefined();
  });
});
