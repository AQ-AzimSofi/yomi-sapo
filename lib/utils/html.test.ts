import { describe, expect, it } from 'vitest';
import { escapeHtml, neutralizeHtmlTags } from './html';

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('leaves Japanese text unchanged', () => {
    expect(escapeHtml('今日は晴れ。')).toBe('今日は晴れ。');
  });
});

describe('neutralizeHtmlTags', () => {
  it('turns every tag opener into an entity so no tag is rendered', () => {
    expect(neutralizeHtmlTags('**意味**<img src=x onerror=alert(1)>')).toBe('**意味**&lt;img src=x onerror=alert(1)>');
  });

  it('keeps markdown blockquote and emphasis markers', () => {
    expect(neutralizeHtmlTags('> 引用\n**強調**')).toBe('> 引用\n**強調**');
  });
});
