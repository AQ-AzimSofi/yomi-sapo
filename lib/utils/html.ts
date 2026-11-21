const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/**
 * Makes markdown safe to pass to a renderer that keeps raw HTML (marked does).
 * Only the tag opener is encoded, so markdown syntax such as `>` blockquotes
 * and `**` emphasis still works while no tag can be rendered.
 */
export function neutralizeHtmlTags(markdown: string): string {
  return markdown.replace(/</g, '&lt;');
}
