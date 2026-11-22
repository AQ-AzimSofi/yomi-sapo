import { describe, expect, it } from 'vitest';
import { GEMINI_CHUNKS, GEMINI_READER_CHUNKS, GEMINI_READER_CHUNKS_WITH_UNMATCHED_HEAD } from './fixtures/geminiV1Book';
import { splitByChunkSeparators, splitByChunkText } from './legacyOutputSplit';

const CHUNK_0 = '<ruby>猫<rt>ねこ</rt></ruby>がいる。\n◆';
const CHUNK_1 = '◆\n犬もいる。';
// The furigana step writes CRLF on Windows and drops spaces; chunks were appended after a plain blank line.
const FURIGANA_0 = '< <ruby>猫<rt>ねこ</rt></ruby>がいる。\r\n>> 猫が います。\r\n\r\n< ◆\r\n>> ◆';
const FURIGANA_1 = '< ◆\r\n>> ◆\r\n\r\n< <ruby>犬<rt>いぬ</rt></ruby>もいる。\r\n>> 犬も います。';

describe('splitByChunkText', () => {
  it('Test_splitByChunkText_SplitsAppendedChunks', () => {
    expect(splitByChunkText(`${FURIGANA_0}\n\n${FURIGANA_1}`, [CHUNK_0, CHUNK_1])).toEqual([FURIGANA_0, FURIGANA_1]);
  });

  it('Test_splitByChunkText_SplitsGeminiChunksWithAHeadPerSentence', () => {
    const readerFile = GEMINI_READER_CHUNKS.join('\n\n');
    expect(splitByChunkText(readerFile, GEMINI_CHUNKS.slice(0, 3))).toEqual(GEMINI_READER_CHUNKS);
  });

  it('Test_splitByChunkText_UnmatchedGeminiHeadIsNotASplit', () => {
    const readerFile = GEMINI_READER_CHUNKS_WITH_UNMATCHED_HEAD.join('\n\n');
    expect(splitByChunkText(readerFile, GEMINI_CHUNKS.slice(0, 3))).toBeUndefined();
  });

  it('Test_splitByChunkText_LineRepeatedAcrossChunksSplitsByLength', () => {
    const [first] = splitByChunkText(`${FURIGANA_0}\n\n${FURIGANA_1}`, [CHUNK_0, CHUNK_1]) ?? [];
    expect(first.endsWith('< ◆\r\n>> ◆')).toBe(true);
  });

  it('Test_splitByChunkText_ExtraChunkIsNotASplit', () => {
    expect(splitByChunkText(`${FURIGANA_0}\n\n${FURIGANA_1}`, [CHUNK_0])).toBeUndefined();
  });

  it('Test_splitByChunkText_DifferentHeadIsNotASplit', () => {
    expect(splitByChunkText(FURIGANA_0.replace('がいる', 'はいない'), [CHUNK_0])).toBeUndefined();
  });

  it('Test_splitByChunkText_HeadAcrossAChunkBoundaryIsNotASplit', () => {
    const straddling = '< 猫がいる。\n>> 猫\n\n< ◆◆\n>> ◆\n\n< 犬もいる。\n>> 犬';
    expect(splitByChunkText(straddling, [CHUNK_0, CHUNK_1])).toBeUndefined();
  });

  it('Test_splitByChunkText_PreambleGoesWithItsChunk', () => {
    const preambled = `以下が要約です。\n${FURIGANA_1}`;
    expect(splitByChunkText(`${FURIGANA_0}\n\n${preambled}`, [CHUNK_0, CHUNK_1])).toEqual([FURIGANA_0, preambled]);
  });

  it('Test_splitByChunkText_NoSeparatorBetweenChunksIsNotASplit', () => {
    expect(splitByChunkText(`${FURIGANA_0}\r\n\r\n${FURIGANA_1}`, [CHUNK_0, CHUNK_1])).toBeUndefined();
  });

  it('Test_splitByChunkText_NoChunkMatchesOnlyEmptyText', () => {
    expect(splitByChunkText('', [])).toEqual([]);
    expect(splitByChunkText('以下が要約です。', [])).toBeUndefined();
  });
});

describe('splitByChunkSeparators', () => {
  it('Test_splitByChunkSeparators_SplitsAppendedChunks', () => {
    expect(splitByChunkSeparators(`${FURIGANA_0}\n\n${FURIGANA_1}`, [CHUNK_0, CHUNK_1])).toEqual([FURIGANA_0, FURIGANA_1]);
  });

  it('Test_splitByChunkSeparators_SplitsGeminiChunksWithAnUnmatchedHead', () => {
    const readerFile = GEMINI_READER_CHUNKS_WITH_UNMATCHED_HEAD.join('\n\n');
    expect(splitByChunkSeparators(readerFile, GEMINI_CHUNKS.slice(0, 3))).toEqual(GEMINI_READER_CHUNKS_WITH_UNMATCHED_HEAD);
  });

  it('Test_splitByChunkSeparators_UnmatchedHeadLongerThanTheRestStillSplits', () => {
    const rewordedSecondChunk = '< ◆\r\n>> ◆\r\n\r\n< 犬がたくさんいるようだ。\r\n>> 犬が います。';
    expect(splitByChunkSeparators(`${FURIGANA_0}\n\n${rewordedSecondChunk}`, [CHUNK_0, CHUNK_1])).toEqual([FURIGANA_0, rewordedSecondChunk]);
  });

  it('Test_splitByChunkSeparators_ExtraChunkIsNotASplit', () => {
    expect(splitByChunkSeparators(`${FURIGANA_0}\n\n${FURIGANA_1}`, [CHUNK_0])).toBeUndefined();
  });

  it('Test_splitByChunkSeparators_BareLineBreakInsideAChunkIsNotASplit', () => {
    const chunkWithoutFurigana = '< 犬もいる。\n>> 犬も います。';
    expect(splitByChunkSeparators(`${FURIGANA_0}\n\n${chunkWithoutFurigana}`, [CHUNK_0, CHUNK_1])).toBeUndefined();
  });

  it('Test_splitByChunkSeparators_ChunkAppendedTwiceIsNotASplit', () => {
    expect(splitByChunkSeparators(`${FURIGANA_0}\n\n${FURIGANA_0}`, [CHUNK_0, CHUNK_1])).toBeUndefined();
  });

  it('Test_splitByChunkSeparators_OtherTextIsNotASplit', () => {
    expect(splitByChunkSeparators('< 別の本。\r\n>> 別。', [CHUNK_0])).toBeUndefined();
  });
});
