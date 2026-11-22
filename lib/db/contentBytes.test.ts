import { describe, expect, it } from 'vitest';
import { withCurrentContentBytes } from './contentBytes';

describe('withCurrentContentBytes', () => {
  it('keeps content_bytes that equals the UTF-8 size of the text', () => {
    const row = { content: 'あa', content_bytes: 4 };

    expect(withCurrentContentBytes(row)).toBe(row);
  });

  it('accepts content_bytes read as text', () => {
    expect(withCurrentContentBytes({ content: 'あa', content_bytes: '4' }).content_bytes).toBe('4');
  });

  it('clears content_bytes left over from an earlier text of another size', () => {
    expect(withCurrentContentBytes({ id: 516, content: 'あa', content_bytes: 2 })).toEqual({ id: 516, content: 'あa', content_bytes: null });
  });

  it('leaves a row without content_bytes alone', () => {
    const row = { content: 'あ', content_bytes: null };

    expect(withCurrentContentBytes(row)).toBe(row);
  });
});
