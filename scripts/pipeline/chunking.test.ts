import { describe, expect, it } from 'vitest';
import { chunkText, stripRubyTags } from './chunking';

describe('stripRubyTags', () => {
  it('Test_stripRubyTags_KeepsEveryBaseOfMultiPartRuby', () => {
    expect(stripRubyTags('<ruby>一<rt>いつ</rt>色<rt>しき</rt></ruby>')).toBe('一色');
  });

  it('Test_stripRubyTags_DropsRpAndRb', () => {
    expect(stripRubyTags('<ruby><rb>漢</rb><rp>(</rp><rt>かん</rt><rp>)</rp></ruby>')).toBe('漢');
  });
});

describe('chunkText', () => {
  it('Test_chunkText_KeepsParagraphsTogetherUnderTarget', () => {
    expect(chunkText('aa\n\nbb', 10).chunks).toEqual(['aa\n\nbb']);
  });

  it('Test_chunkText_StartsNewChunkAtParagraphOverTarget', () => {
    const { chunks, boundaries } = chunkText('aaaa\n\nbbbb', 6);
    expect(chunks).toEqual(['aaaa', 'bbbb']);
    expect(boundaries).toEqual([{ start: 0, end: 6 }, { start: 6, end: 12 }]);
  });

  it('Test_chunkText_MeasuresTextWithoutRuby', () => {
    const rubyParagraph = '<ruby>漢<rt>かん</rt></ruby>字';
    expect(chunkText(`${rubyParagraph}\n\n${rubyParagraph}`, 6).chunks).toHaveLength(1);
  });

  it('Test_chunkText_SplitsLongParagraphAtSentenceEnds', () => {
    expect(chunkText('あいう。えおか。きくけ。', 8).chunks).toEqual(['あいう。えおか。', 'きくけ。']);
  });

  it('Test_chunkText_SkipsBlankParagraphs', () => {
    expect(chunkText('a\n\n \n\nb', 100).chunks).toEqual(['a\n\nb']);
  });
});
