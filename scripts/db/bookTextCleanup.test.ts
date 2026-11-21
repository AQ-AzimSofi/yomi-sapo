import { describe, expect, it } from 'vitest';
import { cleanBookText } from './bookTextCleanup';

describe('cleanBookText', () => {
  it('turns Windows line endings into LF', () => {
    expect(cleanBookText('< 一\r\n>> い\r\n\r\n< 二').cleaned).toBe('< 一\n>> い\n\n< 二');
  });

  it('removes a leaked <bos> token', () => {
    expect(cleanBookText('彼が言<bos>言及した').cleaned).toBe('彼が言言及した');
  });

  it('drops calibre class attributes from ruby tags', () => {
    expect(cleanBookText('<rubyclass="calibre6"><rbclass="calibre6">白</rb><rtclass="calibre6">しろ</rt></ruby>').cleaned).toBe(
      '<ruby><rb>白</rb><rt>しろ</rt></ruby>'
    );
  });

  it('keeps the book reading when pipeline ruby sits inside an unclosed calibre ruby', () => {
    const nested =
      '<rubyclass="calibre"><rbclass="calibre"><ruby>間<rt>かん</rt></ruby><rtclass="s">ま</rt>' +
      '<rbclass="calibre"><ruby>違<rt>い</rt></ruby><rtclass="s">ちが</rt>える';

    expect(cleanBookText(nested).cleaned).toBe('<ruby>間<rt>ま</rt></ruby><ruby>違<rt>ちが</rt></ruby>える');
  });

  it('unwraps a tate-chu-yoko span and keeps its text', () => {
    expect(cleanBookText('記号<spanclass="tcy">α</span>と<span class="tcy">β</span>').cleaned).toBe('記号αとβ');
  });

  it('replaces a gaiji image inside ruby with its reading', () => {
    expect(cleanBookText('角<ruby><rb>[IMAGE:00017.jpeg]</rb><rt>シータ</rt></ruby>を測る').cleaned).toBe('角シータを測る');
  });

  it('replaces a gaiji image inside calibre-classed ruby with its reading', () => {
    expect(cleanBookText('<rubyclass="c"><rbclass="c">[IMAGE:01.png]</rb><rtclass="c">こぶし</rt></ruby>').cleaned).toBe('こぶし');
  });

  it('replaces a gaiji image on its own lines inside ruby with its reading', () => {
    expect(cleanBookText('オーラが<ruby>\r\n[IMAGE:gaiji-1.png]\r\n<rt>ほとばし</rt></ruby>ってる').cleaned).toBe(
      'オーラがほとばしってる'
    );
  });

  it('turns a gaiji pair inside a longer ruby into its reading as plain base text', () => {
    expect(cleanBookText('<ruby><rb>[IMAGE:00021.jpeg]</rb><rt>しっ</rt><rb>貝</rb><rt>ぺい</rt></ruby>').cleaned).toBe(
      '<ruby><rb>しっ</rb><rt></rt><rb>貝</rb><rt>ぺい</rt></ruby>'
    );
  });

  it('leaves well-formed ruby, footnote superscripts and code text alone', () => {
    const content = '<ruby>幼<rt>おさな</rt>馴<rt>な</rt></ruby>の<sup>*1</sup>と<div id="x">';

    expect(cleanBookText(content).cleaned).toBe(content);
  });

  it('counts what each rule removed', () => {
    expect(cleanBookText('a<bos>b<bos><spanclass="tcy">c</span>').removedByRule).toEqual({
      'Windows line ending': 0,
      'model <bos> token': 2,
      'calibre class on a ruby tag': 0,
      'tate-chu-yoko span': 2,
      'pipeline ruby nested in calibre ruby': 0,
      'gaiji image ruby': 0,
      'gaiji image pair in a longer ruby': 0,
    });
  });

  it('changes nothing on a second run', () => {
    const once = cleanBookText('<rubyclass="c">字<rtclass="c">じ</rt></ruby><bos>').cleaned;

    expect(cleanBookText(once).cleaned).toBe(once);
  });
});
