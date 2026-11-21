import { describe, expect, it } from 'vitest';
import { renderSafeMarkdown } from './safeMarkdown';

describe('renderSafeMarkdown', () => {
  it('renders headings, emphasis and lists', () => {
    expect(renderSafeMarkdown('## 意味\n\n- **大事**な点')).toBe('<h2>意味</h2>\n<ul>\n<li><strong>大事</strong>な点</li>\n</ul>\n');
  });

  it('shows a < inside a code span as text, escaped once', () => {
    expect(renderSafeMarkdown('`a < b`')).toBe('<p><code>a &lt; b</code></p>\n');
  });

  it('escapes an inline tag with an event handler instead of rendering it', () => {
    const html = renderSafeMarkdown('説明<img src=x onerror=alert(1)>です');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes a block-level tag instead of rendering it', () => {
    expect(renderSafeMarkdown('<div onclick="x">hi</div>')).not.toContain('<div');
  });

  it('keeps an https link', () => {
    expect(renderSafeMarkdown('[公式](https://example.com)')).toBe('<p><a href="https://example.com">公式</a></p>\n');
  });

  it('keeps an autolinked https address', () => {
    expect(renderSafeMarkdown('<https://example.com>')).toBe(
      '<p><a href="https://example.com">https://example.com</a></p>\n'
    );
  });

  it('renders a javascript: link as its text only', () => {
    expect(renderSafeMarkdown('[押す](javascript:alert(1))')).toBe('<p>押す</p>\n');
  });

  it('renders an entity-encoded javascript: link as its text only', () => {
    expect(renderSafeMarkdown('[押す](javascript&colon;alert(1))')).toBe('<p>押す</p>\n');
  });

  it('renders an image as its alt text so no remote image loads', () => {
    expect(renderSafeMarkdown('![図](https://example.com/a.png)')).toBe('<p>図</p>\n');
  });
});
