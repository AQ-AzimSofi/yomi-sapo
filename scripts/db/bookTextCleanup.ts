interface CleanupRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface BookTextCleanup {
  cleaned: string;
  removedByRule: Record<string, number>;
}

// Line endings are normalized first so every later rule sees LF. Calibre class
// attributes are normalized before the gaiji rules so those also catch ruby
// that calibre wrote with classes. A gaiji is a character the EPUB shipped as
// an image; its reading is the only text we have for it.
const CLEANUP_RULES: CleanupRule[] = [
  { name: 'Windows line ending', pattern: /\r\n?/g, replacement: '\n' },
  { name: 'model <bos> token', pattern: /<bos>/g, replacement: '' },
  { name: 'calibre class on a ruby tag', pattern: /<(ruby|rb|rt) ?class="[^"]*">/g, replacement: '<$1>' },
  { name: 'tate-chu-yoko span', pattern: /<span ?class="[^"]*">|<\/span>/g, replacement: '' },
  {
    // The pipeline added its own ruby inside calibre's unclosed one; the book's reading is the right one.
    name: 'pipeline ruby nested in calibre ruby',
    pattern: /(?:<ruby>)?<rb><ruby>([^<]+)<rt>[^<]*<\/rt><\/ruby><rt>([^<]*)<\/rt>/g,
    replacement: '<ruby>$1<rt>$2</rt></ruby>',
  },
  {
    name: 'gaiji image ruby',
    pattern: /<ruby>\s*(?:<rb>)?\s*\[IMAGE:[^\]]+\]\s*(?:<\/rb>)?\s*<rt>([^<]*)<\/rt><\/ruby>/g,
    replacement: '$1',
  },
  { name: 'gaiji image pair in a longer ruby', pattern: /<rb>\[IMAGE:[^\]]+\]<\/rb><rt>([^<]*)<\/rt>/g, replacement: '<rb>$1</rb><rt></rt>' },
];

export function cleanBookText(content: string): BookTextCleanup {
  return CLEANUP_RULES.reduce<BookTextCleanup>(
    (result, rule) => ({
      cleaned: result.cleaned.replace(rule.pattern, rule.replacement),
      removedByRule: { ...result.removedByRule, [rule.name]: result.cleaned.match(rule.pattern)?.length ?? 0 },
    }),
    { cleaned: content, removedByRule: {} }
  );
}
