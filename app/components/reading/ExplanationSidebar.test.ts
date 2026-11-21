import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ExplanationSidebar from './ExplanationSidebar';

const RUBY_SENTENCE = '<ruby><rb>漢字</rb><rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む。';

function renderSelectedSentence(showFurigana: boolean): string {
  const html = renderToString(
    createElement(ExplanationSidebar, {
      isOpen: true,
      onClose: () => {},
      sentence: RUBY_SENTENCE,
      context: '',
      fileName: 'book',
      showFurigana,
    })
  );
  const sentenceBlock = html.split('Selected Sentence')[1] ?? '';
  return sentenceBlock.slice(sentenceBlock.indexOf('<p'), sentenceBlock.indexOf('</p>') + '</p>'.length);
}

describe('ExplanationSidebar selected sentence', () => {
  it('shows the base text without any ruby markup when furigana is off', () => {
    const sentence = renderSelectedSentence(false);

    expect(sentence).toContain('漢字を読む。');
    expect(sentence).not.toContain('ruby');
    expect(sentence).not.toContain('かんじ');
  });

  it('shows the readings as ruby when furigana is on', () => {
    expect(renderSelectedSentence(true)).toContain('<ruby>漢字<rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む。');
  });
});
