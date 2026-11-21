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
    expect(renderSafeMarkdown('<div onclick="x">hi</div>')).toBe('&lt;div onclick=&quot;x&quot;&gt;hi&lt;/div&gt;');
  });

  it('keeps text escaped after an inline <script> tag', () => {
    expect(renderSafeMarkdown('a <script> <img src=x onerror=alert(1)// b')).toBe(
      '<p>a &lt;script&gt; &lt;img src=x onerror=alert(1)// b</p>\n'
    );
  });

  it('keeps the next paragraph escaped after an inline <pre> tag', () => {
    expect(renderSafeMarkdown('x <pre>\n\n<img src=x onerror=alert(1)//')).toBe(
      '<p>x &lt;pre&gt;</p>\n<p>&lt;img src=x onerror=alert(1)//</p>\n'
    );
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

  it.each([
    "[x](javascript:fetch('https://evil'))",
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](vbscript:msgbox(1))',
    '[x][r]\n\n[r]: javascript:alert(1)',
  ])('renders %j as its text only', (markdown) => {
    expect(renderSafeMarkdown(markdown)).toBe('<p>x</p>\n');
  });

  it('keeps a mailto link', () => {
    expect(renderSafeMarkdown('[連絡](mailto:a@example.com)')).toBe('<p><a href="mailto:a@example.com">連絡</a></p>\n');
  });

  it('renders an entity-encoded javascript: link as its text only', () => {
    expect(renderSafeMarkdown('[押す](javascript&colon;alert(1))')).toBe('<p>押す</p>\n');
  });

  it('renders an image as its alt text so no remote image loads', () => {
    expect(renderSafeMarkdown('![図](https://example.com/a.png)')).toBe('<p>図</p>\n');
  });

  it('escapes markup in image alt text', () => {
    expect(renderSafeMarkdown('![<img src=x onerror=alert(1)>](a.png)')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>\n');
  });
});
