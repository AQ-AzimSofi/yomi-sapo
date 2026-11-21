import { describe, it, expect } from 'vitest';
import { cleanTextForTTS } from './ttsTextCleaner';

describe('cleanTextForTTS', () => {
  it('returns an empty string for empty input', () => {
    expect(cleanTextForTTS('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(cleanTextForTTS('春が来た。')).toBe('春が来た。');
  });

  it('removes an image marker', () => {
    expect(cleanTextForTTS('[IMAGE:p1.png]春が来た。')).toBe('春が来た。');
  });

  it('removes a title line that starts with an arrow', () => {
    expect(cleanTextForTTS('前\n→Title: 題名\n後')).toBe('前\n\n後');
  });

  it('removes an author line with the arrow', () => {
    expect(cleanTextForTTS('→Author: 著者\n本文')).toBe('本文');
  });

  it('removes an author line without the arrow', () => {
    expect(cleanTextForTTS('Author: 著者\n本文')).toBe('本文');
  });

  it('keeps a title marker that is not at the start of a line', () => {
    expect(cleanTextForTTS('本文 →Title: 題名')).toBe('本文 →Title: 題名');
  });

  it('strips bracket furigana and keeps the base text', () => {
    expect(cleanTextForTTS('学校[がっこう]へ行く')).toBe('学校へ行く');
  });

  it('strips an HTML ruby tag and keeps the base text', () => {
    expect(cleanTextForTTS('<ruby>春香<rt>はるか</rt></ruby>が来た')).toBe('春香が来た');
  });

  it('collapses runs of spaces and tabs to one space', () => {
    expect(cleanTextForTTS('あ  \t い')).toBe('あ い');
  });

  it('keeps an inner ideographic space but trims ideographic spaces at the ends', () => {
    expect(cleanTextForTTS('　あ　い　')).toBe('あ　い');
  });

  it('collapses three or more newlines to one blank line', () => {
    expect(cleanTextForTTS('あ\n\n\n\nい')).toBe('あ\n\nい');
  });

  it.todo('collapses three or more CRLF line breaks the same way as LF (bug)');

  it('trims surrounding whitespace', () => {
    expect(cleanTextForTTS('\n あ \n')).toBe('あ');
  });
});
