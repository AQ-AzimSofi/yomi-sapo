// Where a ruby registry entry came from: the EPUB's ruby markup (scripts/core/extract-ruby-smart.py
// writes epub_smart) or the owner, through the registry edit page.
export const RUBY_ENTRY_SOURCES = ['epub', 'epub_smart', 'user'] as const;

export type RubyEntrySource = (typeof RUBY_ENTRY_SOURCES)[number];

export function isRubyEntrySource(value: unknown): value is RubyEntrySource {
  return RUBY_ENTRY_SOURCES.some((source) => source === value);
}
