import { describe, expect, it } from 'vitest';
import { isRubyEntrySource } from './rubyEntrySource';

describe('isRubyEntrySource', () => {
  it.each(['epub', 'epub_smart', 'user'])('accepts %s', (source) => {
    expect(isRubyEntrySource(source)).toBe(true);
  });

  it.each(['admin', '', undefined, 1])('refuses %s', (source) => {
    expect(isRubyEntrySource(source)).toBe(false);
  });
});
