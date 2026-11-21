import { describe, expect, it } from 'vitest';
import { cleanStrayMarkup } from './strayMarkup';

describe('cleanStrayMarkup', () => {
  it('removes a leaked <bos> token', () => {
    expect(cleanStrayMarkup('彼が言<bos>言及した').cleaned).toBe('彼が言言及した');
  });

  it('drops calibre class attributes from ruby tags', () => {
    expect(cleanStrayMarkup('<rubyclass="calibre6"><rbclass="calibre6">白</rb><rtclass="calibre6">しろ</rt></ruby>').cleaned).toBe(
      '<ruby><rb>白</rb><rt>しろ</rt></ruby>'
    );
  });

  it('keeps the book reading when pipeline ruby sits inside an unclosed calibre ruby', () => {
    const nested =
      '<rubyclass="calibre"><rbclass="calibre"><ruby>間<rt>かん</rt></ruby><rtclass="s">ま</rt>' +
      '<rbclass="calibre"><ruby>違<rt>い</rt></ruby><rtclass="s">ちが</rt>える';

    expect(cleanStrayMarkup(nested).cleaned).toBe('<ruby>間<rt>ま</rt></ruby><ruby>違<rt>ちが</rt></ruby>える');
  });

  it('keeps the book reading when pipeline ruby sits inside a closed calibre ruby', () => {
    expect(cleanStrayMarkup('<ruby><rb><ruby>間<rt>かん</rt></ruby><rt>ま</rt></ruby>に').cleaned).toBe('<ruby>間<rt>ま</rt></ruby>に');
  });

  it('unwraps a tate-chu-yoko span and keeps its text', () => {
    expect(cleanStrayMarkup('記号<spanclass="tcy">α</span>と<span class="tcy">β</span>').cleaned).toBe('記号αとβ');
  });

  it('replaces a gaiji image inside ruby with its reading', () => {
    expect(cleanStrayMarkup('角<ruby><rb>[IMAGE:00017.jpeg]</rb><rt>シータ</rt></ruby>を測る').cleaned).toBe('角シータを測る');
  });

  it('replaces a gaiji image inside calibre-classed ruby with its reading', () => {
    expect(cleanStrayMarkup('<rubyclass="c"><rbclass="c">[IMAGE:01.png]</rb><rtclass="c">こぶし</rt></ruby>').cleaned).toBe('こぶし');
  });

  it('replaces a gaiji image on its own lines inside ruby with its reading', () => {
    expect(cleanStrayMarkup('オーラが<ruby>\r\n[IMAGE:gaiji-1.png]\r\n<rt>ほとばし</rt></ruby>ってる').cleaned).toBe(
      'オーラがほとばしってる'
    );
  });

  it('turns a gaiji pair inside a longer ruby into its reading as plain base text', () => {
    expect(cleanStrayMarkup('<ruby><rb>[IMAGE:00021.jpeg]</rb><rt>しっ</rt><rb>貝</rb><rt>ぺい</rt></ruby>').cleaned).toBe(
      '<ruby><rb>しっ</rb><rt></rt><rb>貝</rb><rt>ぺい</rt></ruby>'
    );
  });

  it('leaves a lone closing span and a span without a class alone', () => {
    const content = 'HTMLでは<span>強調</span>と書き、閉じタグは</span>だ';

    expect(cleanStrayMarkup(content).cleaned).toBe(content);
  });

  it('leaves well-formed ruby, footnote superscripts and code text alone', () => {
    const content = '<ruby>幼<rt>おさな</rt>馴<rt>な</rt></ruby>の<sup>*1</sup>と<div id="x">';

    expect(cleanStrayMarkup(content).cleaned).toBe(content);
  });

  it('counts what each rule removed', () => {
    expect(cleanStrayMarkup('a<bos>b<bos><spanclass="tcy">c</span>').removedByRule).toEqual({
      'model <bos> token': 2,
      'calibre class on a ruby tag': 0,
      'tate-chu-yoko span': 1,
      'pipeline ruby nested in calibre ruby': 0,
      'gaiji image ruby': 0,
      'gaiji image pair in a longer ruby': 0,
    });
  });

  it('changes nothing on a second run', () => {
    const once = cleanStrayMarkup('<rubyclass="c">字<rtclass="c">じ</rt></ruby><bos>').cleaned;

    expect(cleanStrayMarkup(once).cleaned).toBe(once);
  });
});
