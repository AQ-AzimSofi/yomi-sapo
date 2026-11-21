import { describe, it, expect } from 'vitest';
import { parseFurigana, segmentsToHTML, stripFurigana, type FuriganaSegment } from './furiganaParser';

describe('parseFurigana', () => {
  it('returns plain text with no markup as one text segment', () => {
    expect(parseFurigana('ひらがなだけ')).toEqual([{ type: 'text', text: 'ひらがなだけ' }]);
  });

  it('returns an empty string as one empty text segment', () => {
    expect(parseFurigana('')).toEqual([{ type: 'text', text: '' }]);
  });

  it('reads a ruby tag as a ruby segment', () => {
    expect(parseFurigana('<ruby>漢字<rt>かんじ</rt></ruby>')).toEqual([
      { type: 'ruby', text: '漢字', ruby: 'かんじ' },
    ]);
  });

  it('reads a ruby tag whose base text is wrapped in rb', () => {
    expect(parseFurigana('<ruby><rb>漢字</rb><rt>かんじ</rt></ruby>')).toEqual([
      { type: 'ruby', text: '漢字', ruby: 'かんじ' },
    ]);
  });

  it('reads several ruby tags in one line with the text between them', () => {
    expect(parseFurigana('<ruby>今日<rt>きょう</rt></ruby>は<ruby>雨<rt>あめ</rt></ruby>です')).toEqual([
      { type: 'ruby', text: '今日', ruby: 'きょう' },
      { type: 'text', text: 'は' },
      { type: 'ruby', text: '雨', ruby: 'あめ' },
      { type: 'text', text: 'です' },
    ]);
  });

  it('reads a line that is only a bracket reading', () => {
    expect(parseFurigana('漢字[かんじ]')).toEqual([{ type: 'ruby', text: '漢字', ruby: 'かんじ' }]);
  });

  it('reads back-to-back bracket readings as separate ruby segments', () => {
    expect(parseFurigana('漢[かん]字[じ]')).toEqual([
      { type: 'ruby', text: '漢', ruby: 'かん' },
      { type: 'ruby', text: '字', ruby: 'じ' },
    ]);
  });

  it.each(['\n', '\r\n'])('keeps the %j line break before a bracket reading on the next line', (lineBreak) => {
    expect(parseFurigana(`一行目${lineBreak}漢字[かんじ]`)).toEqual([
      { type: 'text', text: `一行目${lineBreak}` },
      { type: 'ruby', text: '漢字', ruby: 'かんじ' },
    ]);
  });

  it('reads a bracket reading followed by a ruby tag', () => {
    expect(parseFurigana('川[かわ]と<ruby>山<rt>やま</rt></ruby>')).toEqual([
      { type: 'ruby', text: '川', ruby: 'かわ' },
      { type: 'text', text: 'と' },
      { type: 'ruby', text: '山', ruby: 'やま' },
    ]);
  });

  it('leaves a line that is only an [IMAGE:...] marker as plain text', () => {
    expect(parseFurigana('[IMAGE:pic.png]')).toEqual([{ type: 'text', text: '[IMAGE:pic.png]' }]);
  });

  it('leaves a bracket with no base text before it as plain text', () => {
    expect(parseFurigana('[かんじ]')).toEqual([{ type: 'text', text: '[かんじ]' }]);
  });

  it('leaves a bracket with an empty reading as plain text', () => {
    expect(parseFurigana('漢字[]')).toEqual([{ type: 'text', text: '漢字[]' }]);
  });

  it('uses only the kanji right before the bracket as the base text', () => {
    expect(parseFurigana('これは漢字[かんじ]です')).toEqual([
      { type: 'text', text: 'これは' },
      { type: 'ruby', text: '漢字', ruby: 'かんじ' },
      { type: 'text', text: 'です' },
    ]);
  });

  it('reads a bracket reading that comes after a ruby tag on the same line', () => {
    expect(parseFurigana('<ruby>山<rt>やま</rt></ruby>と川[かわ]')).toEqual([
      { type: 'ruby', text: '山', ruby: 'やま' },
      { type: 'text', text: 'と' },
      { type: 'ruby', text: '川', ruby: 'かわ' },
    ]);
  });

  it('keeps text before a ruby tag once when a bracket reading follows the tag', () => {
    expect(parseFurigana('前<ruby>山<rt>やま</rt></ruby>川[かわ]')).toEqual([
      { type: 'text', text: '前' },
      { type: 'ruby', text: '山', ruby: 'やま' },
      { type: 'ruby', text: '川', ruby: 'かわ' },
    ]);
  });

  it('splits a ruby tag with several base/reading pairs into one segment per pair', () => {
    expect(parseFurigana('<ruby>幼<rt>おさな</rt>馴<rt>な</rt>染<rt>じみ</rt></ruby>')).toEqual([
      { type: 'ruby', text: '幼', ruby: 'おさな' },
      { type: 'ruby', text: '馴', ruby: 'な' },
      { type: 'ruby', text: '染', ruby: 'じみ' },
    ]);
  });

  it('splits a ruby tag with several rb/rt pairs', () => {
    expect(parseFurigana('<ruby><rb>漢</rb><rt>かん</rt><rb>字</rb><rt>じ</rt></ruby>')).toEqual([
      { type: 'ruby', text: '漢', ruby: 'かん' },
      { type: 'ruby', text: '字', ruby: 'じ' },
    ]);
  });

  it('does not read an [IMAGE:...] marker that follows text as a reading', () => {
    expect(parseFurigana('前の図[IMAGE:pic.png]')).toEqual([{ type: 'text', text: '前の図[IMAGE:pic.png]' }]);
  });

  it('keeps a bracket around a ruby tag as plain text around the ruby', () => {
    expect(parseFurigana(' [<ruby>画像<rt>がぞう</rt></ruby>]')).toEqual([
      { type: 'text', text: ' [' },
      { type: 'ruby', text: '画像', ruby: 'がぞう' },
      { type: 'text', text: ']' },
    ]);
  });

  it('scans a long line without brackets in linear time', () => {
    const longLine = 'あ'.repeat(200_000);
    const startedMs = performance.now();

    parseFurigana(longLine);

    expect(performance.now() - startedMs).toBeLessThan(100);
  });
});

describe('segmentsToHTML', () => {
  const sentence: FuriganaSegment[] = [
    { type: 'ruby', text: '今日', ruby: 'きょう' },
    { type: 'text', text: 'は晴れ' },
  ];

  it('wraps ruby segments in ruby tags when furigana is shown', () => {
    expect(segmentsToHTML(sentence, true)).toBe('<ruby>今日<rt>きょう</rt></ruby>は晴れ');
  });

  it('outputs only the base text of ruby segments when furigana is hidden', () => {
    expect(segmentsToHTML(sentence, false)).toBe('今日は晴れ');
  });

  it('outputs only the base text of a ruby segment that has no reading', () => {
    expect(segmentsToHTML([{ type: 'ruby', text: '漢字' }], true)).toBe('漢字');
  });

  it('outputs only the base text of a ruby segment with an empty reading', () => {
    expect(segmentsToHTML([{ type: 'ruby', text: '漢字', ruby: '' }], true)).toBe('漢字');
  });

  it('returns an empty string for no segments', () => {
    expect(segmentsToHTML([], true)).toBe('');
  });

  it('escapes markup in plain text so it shows as text', () => {
    expect(segmentsToHTML([{ type: 'text', text: '型は<string>&"引用"\'' }], true)).toBe(
      '型は&lt;string&gt;&amp;&quot;引用&quot;&#39;'
    );
  });

  it('escapes markup in the base text and reading of a ruby segment', () => {
    expect(segmentsToHTML([{ type: 'ruby', text: '<i>字', ruby: '<b>じ' }], true)).toBe(
      '<ruby>&lt;i&gt;字<rt>&lt;b&gt;じ</rt></ruby>'
    );
  });

  it('escapes an event-handler tag instead of rendering it', () => {
    expect(segmentsToHTML([{ type: 'text', text: '<img src=x onerror=alert(1)>' }], true)).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  it('renders a parsed multi-pair ruby tag as one ruby per pair with no escaped markup', () => {
    expect(segmentsToHTML(parseFurigana('<ruby>緋<rt>ひ</rt>色<rt>いろ</rt></ruby>の空'), true)).toBe(
      '<ruby>緋<rt>ひ</rt></ruby><ruby>色<rt>いろ</rt></ruby>の空'
    );
  });

  it('keeps the superscript tags that books use for footnote marks', () => {
    expect(segmentsToHTML([{ type: 'text', text: '原理である<sup>*19</sup>」' }], true)).toBe(
      '原理である<sup>*19</sup>」'
    );
  });

  it('escapes a superscript tag that carries attributes', () => {
    expect(segmentsToHTML([{ type: 'text', text: '<sup onclick="x">1</sup>' }], true)).toBe(
      '&lt;sup onclick=&quot;x&quot;&gt;1</sup>'
    );
  });
});

describe('stripFurigana', () => {
  it('returns plain text unchanged', () => {
    expect(stripFurigana('ひらがなだけ')).toBe('ひらがなだけ');
  });

  it('keeps only the base text of ruby tags with and without rb', () => {
    expect(stripFurigana('<ruby>今日<rt>きょう</rt></ruby>は<ruby><rb>雨</rb><rt>あめ</rt></ruby>です')).toBe(
      '今日は雨です'
    );
  });

  it('removes a bracket reading in the middle of a sentence', () => {
    expect(stripFurigana('これは漢字[かんじ]です')).toBe('これは漢字です');
  });

  it('removes a bracket reading and a ruby tag from mixed content across lines', () => {
    expect(stripFurigana('一行目\n川[かわ]と<ruby>山<rt>やま</rt></ruby>')).toBe('一行目\n川と山');
  });

  it('keeps a line that is only an [IMAGE:...] marker', () => {
    expect(stripFurigana('[IMAGE:pic.png]')).toBe('[IMAGE:pic.png]');
  });

  it('removes every reading from a line where a bracket reading comes after a ruby tag', () => {
    expect(stripFurigana('<ruby>山<rt>やま</rt></ruby>と川[かわ]')).toBe('山と川');
  });

  it('keeps text before a ruby tag once, without the tag markup, when a bracket reading follows the tag', () => {
    expect(stripFurigana('前<ruby>山<rt>やま</rt></ruby>と川[かわ]')).toBe('前山と川');
  });

  it('keeps every base character of a multi-part ruby tag', () => {
    expect(stripFurigana('<ruby><rb>漢</rb><rt>かん</rt><rb>字</rb><rt>じ</rt></ruby>')).toBe('漢字');
  });
});
