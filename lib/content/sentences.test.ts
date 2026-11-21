import { describe, expect, it } from 'vitest';
import { sentenceOccurrence, splitIntoSentences } from './sentences';

describe('splitIntoSentences', () => {
  it('cuts after each delimiter and keeps the delimiter with its sentence', () => {
    expect(splitIntoSentences('一文目。二文目！三文目？')).toEqual(['一文目。', '二文目！', '三文目？']);
  });

  it('keeps trailing text without a delimiter as the last sentence', () => {
    expect(splitIntoSentences('一文目。続き')).toEqual(['一文目。', '続き']);
  });

  it('trims each sentence and drops the empty ones', () => {
    expect(splitIntoSentences(' 一文目。\u3000\n二文目。 \n')).toEqual(['一文目。', '二文目。']);
    expect(splitIntoSentences('')).toEqual([]);
  });

  it('cuts inside quotes, leaving the closing bracket to the next sentence', () => {
    expect(splitIntoSentences('「え？」はい。')).toEqual(['「え？', '」はい。']);
  });

  it('gives a run of delimiters one sentence each', () => {
    expect(splitIntoSentences('本当？！')).toEqual(['本当？', '！']);
  });
});

describe('sentenceOccurrence', () => {
  it('counts the copies of the same text earlier in the list', () => {
    const sentences = ['はい。', 'いいえ。', 'はい。', 'はい。'];

    expect(sentences.map((_, index) => sentenceOccurrence(sentences, index))).toEqual([0, 0, 1, 2]);
  });
});
