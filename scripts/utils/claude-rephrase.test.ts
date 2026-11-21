import { describe, expect, it } from 'vitest';
import { formatPairs, isClaudeModel, numberParagraphs, parseRewrites, splitParagraphs } from './claude-rephrase';

describe('isClaudeModel', () => {
  it('Test_isClaudeModel_ClaudeAlias', () => {
    expect(isClaudeModel('sonnet')).toBe(true);
  });

  it('Test_isClaudeModel_GeminiModel', () => {
    expect(isClaudeModel('gemini-3-flash-preview')).toBe(false);
  });
});

describe('splitParagraphs', () => {
  it('Test_splitParagraphs_DropsBlankLinesAndIndent', () => {
    expect(splitParagraphs('　A\n\nB \n')).toEqual(['A', 'B']);
  });
});

describe('numberParagraphs', () => {
  it('Test_numberParagraphs_KeepsBookNumbersForASubset', () => {
    expect(numberParagraphs(['A', 'B', 'C'], [1, 3])).toBe('[1] A\n[3] C');
  });
});

describe('parseRewrites', () => {
  it('Test_parseRewrites_GroupsRewriteAndNote', () => {
    const rewrites = parseRewrites('[1] a\n[2] b\n[2] （note）', new Set([1, 2]));
    expect([...rewrites]).toEqual([[1, ['a']], [2, ['b', '（note）']]]);
  });

  it('Test_parseRewrites_DropsPreambleAndUnrequestedNumbers', () => {
    const rewrites = parseRewrites('以下が言い換えです。\n[1] a\n[9] z', new Set([1]));
    expect([...rewrites]).toEqual([[1, ['a']]]);
  });

  it('Test_parseRewrites_AcceptsFullWidthBrackets', () => {
    expect([...parseRewrites('［1］ a', new Set([1]))]).toEqual([[1, ['a']]]);
  });

  it('Test_parseRewrites_IgnoresEmptyRewrite', () => {
    expect(parseRewrites('[1] ', new Set([1])).size).toBe(0);
  });
});

describe('formatPairs', () => {
  it('Test_formatPairs_WritesOriginalFromBook', () => {
    const rewrites = new Map([[1, ['a']], [2, ['b', '（note）']]]);
    expect(formatPairs(['A', 'B'], rewrites)).toBe('< A\n>> a\n\n< B\n>> b\n>> （note）');
  });

  it('Test_formatPairs_SkippedParagraphShowsOriginal', () => {
    expect(formatPairs(['A'], new Map())).toBe('< A\n>> A');
  });
});
