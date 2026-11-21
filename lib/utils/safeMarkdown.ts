import { Marked, type Tokens } from 'marked';
import { escapeHtml } from './html';

const SAFE_LINK_PATTERN = /^(https?:|mailto:)/i;

// AI output is untrusted: raw HTML is shown as text, links keep only safe
// schemes, and images become their alt text so nothing loads from elsewhere.
const safeMarked = new Marked({
  async: false,
  // After an inline <pre>, <code>, <kbd> or <script> tag, marked marks the text
  // that follows as already escaped and outputs it raw. The tag itself is
  // escaped by the html renderer, so that text must be escaped as usual too.
  walkTokens(token) {
    if (token.type === 'text' && token.escaped) token.escaped = false;
  },
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      if (SAFE_LINK_PATTERN.test(token.href)) return false;
      return this.parser.parseInline(token.tokens);
    },
    image(token: Tokens.Image) {
      return escapeHtml(token.text);
    },
  },
});

export function renderSafeMarkdown(markdown: string): string {
  return safeMarked.parse(markdown) as string;
}
