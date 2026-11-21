import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasEmbeddedHeading,
  isHeadingLine,
  isSubItemLine,
  normalizeHeading,
  parseMarkdown,
  removeBoldFormatting,
  removeHeadingPrefix,
  removeSubItemPrefix,
} from './index';

const joinLines = (...lines: string[]) => lines.join('\n');

const MORNING_BLOCK = joinLines('< 朝が来た。', '>> 朝になった。');
const MORNING_ITEM = { head: ' 朝が来た。', subItems: [' 朝になった。'] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseMarkdown', () => {
  it('reads a "< head" line and its ">> sub" line as one item, keeping the space after each marker', () => {
    expect(parseMarkdown(MORNING_BLOCK)).toEqual([MORNING_ITEM]);
  });

  it('splits blocks separated by a blank line into separate items', () => {
    const text = joinLines(MORNING_BLOCK, '', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: ' 雨が降る。', subItems: [' 雨だ。'] },
    ]);
  });

  it('reads a head and sub with no space after the markers', () => {
    const text = joinLines('<朝が来た。', '>>朝になった。');

    expect(parseMarkdown(text)).toEqual([{ head: '朝が来た。', subItems: ['朝になった。'] }]);
  });

  it('reads a full-width "＜" as a head marker', () => {
    const text = joinLines('＜ 朝が来た。', '>> 朝になった。');

    expect(parseMarkdown(text)).toEqual([MORNING_ITEM]);
  });

  it('joins a head that continues onto the next line, with no separator', () => {
    const text = joinLines('< 雨が降り出したので、', '傘を取りに戻った。', '>> 雨なので傘を取りに戻った。');

    expect(parseMarkdown(text)).toEqual([
      { head: ' 雨が降り出したので、傘を取りに戻った。', subItems: [' 雨なので傘を取りに戻った。'] },
    ]);
  });

  it('collects several ">>" lines under one head in order', () => {
    const text = joinLines('< 朝が来た。', '>> 朝になった。', '>> 夜が明けた。', '>> 朝だ。');

    expect(parseMarkdown(text)).toEqual([
      { head: ' 朝が来た。', subItems: [' 朝になった。', ' 夜が明けた。', ' 朝だ。'] },
    ]);
  });

  it('attaches a ">>" line to its head across a blank line', () => {
    const text = joinLines('< 朝が来た。', '', '>> 朝になった。');

    expect(parseMarkdown(text)).toEqual([MORNING_ITEM]);
  });

  it('keeps a head that has no ">>" line as an item with no sub items', () => {
    const text = joinLines('< 朝が来た。', '', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([
      { head: ' 朝が来た。', subItems: [] },
      { head: ' 雨が降る。', subItems: [' 雨だ。'] },
    ]);
  });

  it('keeps <ruby> markup inside heads and subs unchanged', () => {
    const text = joinLines(
      '< <ruby>駅<rt>えき</rt></ruby>まで歩いた。',
      '>> <ruby>駅<rt>えき</rt></ruby>へ行った。',
    );

    expect(parseMarkdown(text)).toEqual([
      {
        head: ' <ruby>駅<rt>えき</rt></ruby>まで歩いた。',
        subItems: [' <ruby>駅<rt>えき</rt></ruby>へ行った。'],
      },
    ]);
  });

  it('joins a continuation line that starts with <ruby> onto the head instead of reading it as a head marker', () => {
    const text = joinLines('< 彼は', '<ruby>駅<rt>えき</rt></ruby>まで歩いた。', '>> 駅へ行った。');

    expect(parseMarkdown(text)).toEqual([
      { head: ' 彼は<ruby>駅<rt>えき</rt></ruby>まで歩いた。', subItems: [' 駅へ行った。'] },
    ]);
  });

  it('keeps a standalone line that starts with <ruby> whole as its own item', () => {
    const text = joinLines(MORNING_BLOCK, '', '<ruby>序<rt>じょ</rt></ruby>章', '', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '<ruby>序<rt>じょ</rt></ruby>章', subItems: [] },
      { head: ' 雨が降る。', subItems: [' 雨だ。'] },
    ]);
  });

  it('strips a full-width "＜" placed right before <ruby> markup', () => {
    const text = joinLines('＜<ruby>駅<rt>えき</rt></ruby>に着いた。', '>> 駅だ。');

    expect(parseMarkdown(text)).toEqual([
      { head: '<ruby>駅<rt>えき</rt></ruby>に着いた。', subItems: [' 駅だ。'] },
    ]);
  });

  it('keeps an unmarked standalone line between blocks as its own item', () => {
    const text = joinLines(MORNING_BLOCK, '', '第一章', '', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '第一章', subItems: [] },
      { head: ' 雨が降る。', subItems: [' 雨だ。'] },
    ]);
  });

  it('removes "## " from a standalone hash heading between blocks', () => {
    const text = joinLines(MORNING_BLOCK, '', '## 第一章', '', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '第一章', subItems: [] },
      { head: ' 雨が降る。', subItems: [' 雨だ。'] },
    ]);
  });

  it('joins a line that follows a ">>" line onto that sub item with "、"', () => {
    const text = joinLines('< 朝が来た。', '>> 朝になって', '鳥が鳴いた。');

    expect(parseMarkdown(text)).toEqual([
      { head: ' 朝が来た。', subItems: [' 朝になって、鳥が鳴いた。'] },
    ]);
  });

  it('starts a new head at an unmarked line followed by three ">>" lines', () => {
    const text = joinLines(MORNING_BLOCK, '', '雨が降る。', '>> 雨だ。', '>> 雨が降っている。', '>> 雨。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '雨が降る。', subItems: [' 雨だ。', ' 雨が降っている。', ' 雨。'] },
    ]);
  });

  it('strips "**" bold markers from an unmarked head followed by three ">>" lines', () => {
    const text = joinLines(MORNING_BLOCK, '', '**雨が降る。**', '>> 雨だ。', '>> 雨が降っている。', '>> 雨。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '雨が降る。', subItems: [' 雨だ。', ' 雨が降っている。', ' 雨。'] },
    ]);
  });

  it('starts a new head at an unmarked line set off by a blank line before three ">>" lines', () => {
    const text = joinLines(MORNING_BLOCK, '', '雨が降る。', '', '>> 雨だ。', '>> 雨が降っている。', '>> 雨。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '雨が降る。', subItems: [' 雨だ。', ' 雨が降っている。', ' 雨。'] },
    ]);
  });

  it('starts a new head at an unmarked line followed by two ">>" lines and then another block', () => {
    const text = joinLines(
      MORNING_BLOCK,
      '',
      '雨が降る。',
      '>> 雨だ。',
      '>> 雨が降っている。',
      '',
      '< 風が吹く。',
      '>> 風だ。',
    );

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: '雨が降る。', subItems: [' 雨だ。', ' 雨が降っている。'] },
      { head: ' 風が吹く。', subItems: [' 風だ。'] },
    ]);
  });

  it('drops a ">>" line that comes before any head', () => {
    const text = joinLines('>> 朝になった。', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([{ head: ' 雨が降る。', subItems: [' 雨だ。'] }]);
  });

  it('drops an AI separator line that sits right before a head without logging it', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const text = joinLines(MORNING_BLOCK, '', '---', '< 雨が降る。', '>> 雨だ。');

    expect(parseMarkdown(text)).toEqual([
      MORNING_ITEM,
      { head: ' 雨が降る。', subItems: [' 雨だ。'] },
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('splits text with no markers into one item per paragraph', () => {
    const text = joinLines('朝が来た。', '', '雨が降る。', '', '', '風が吹く。');

    expect(parseMarkdown(text)).toEqual([
      { head: '朝が来た。', subItems: [] },
      { head: '雨が降る。', subItems: [] },
      { head: '風が吹く。', subItems: [] },
    ]);
  });

  it('splits text with no markers at space-only lines and trims each paragraph', () => {
    const text = joinLines('  朝が来た。  ', '   ', '雨が降る。');

    expect(parseMarkdown(text)).toEqual([
      { head: '朝が来た。', subItems: [] },
      { head: '雨が降る。', subItems: [] },
    ]);
  });

  it('keeps single line breaks inside a paragraph of text with no markers', () => {
    const text = joinLines('朝が来た。', '鳥が鳴いた。');

    expect(parseMarkdown(text)).toEqual([{ head: '朝が来た。\n鳥が鳴いた。', subItems: [] }]);
  });

  it('treats text whose lines start with <ruby> as text with no markers', () => {
    const text = joinLines('<ruby>駅<rt>えき</rt></ruby>に着いた。', '', '<ruby>朝<rt>あさ</rt></ruby>だ。');

    expect(parseMarkdown(text)).toEqual([
      { head: '<ruby>駅<rt>えき</rt></ruby>に着いた。', subItems: [] },
      { head: '<ruby>朝<rt>あさ</rt></ruby>だ。', subItems: [] },
    ]);
  });

  it('splits CRLF text with no markers into the same paragraphs as LF text', () => {
    expect(parseMarkdown('朝が来た。\r\n\r\n雨が降る。')).toEqual([
      { head: '朝が来た。', subItems: [] },
      { head: '雨が降る。', subItems: [] },
    ]);
  });

  it('returns no items for empty text', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('returns no items for text made only of blank lines', () => {
    expect(parseMarkdown(joinLines('  ', ' ', ''))).toEqual([]);
  });

  it('returns no items and logs an error when isError is true, even for well-formed text', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(parseMarkdown(MORNING_BLOCK, true)).toEqual([]);
    expect(error).toHaveBeenCalledWith('Error: Invalid response format');
  });

  it.todo('parses CRLF text into the same items as LF text, with no "\\r" left in heads or subs (bug)');
  it.todo('keeps an unmarked standalone line that comes before the first head, as it does after one (bug)');
  it.todo('starts a new head at an unmarked line followed by one ">>" line, instead of dropping the line and moving its sub to the previous head (bug)');
  it.todo('starts a new head at an unmarked line followed by four ">>" lines, as it does for three, without repeating the first ">>" line (bug)');
  it.todo('keeps every continuation line after a ">>" line, not only the first one (bug)');
  it.todo('keeps an unmarked line that directly follows a ">>" line and is set off by a blank line before three ">>" lines (bug)');
  it.todo('leaves AI meta lines such as "---" out of the items wherever they appear, as isAiMetaLine documents (bug)');
});

describe('isHeadingLine', () => {
  it('accepts a line that starts with "<"', () => {
    expect(isHeadingLine('< 朝が来た。')).toBe(true);
  });

  it('accepts a line that starts with a full-width "＜"', () => {
    expect(isHeadingLine('＜朝が来た。')).toBe(true);
  });

  it('rejects a line that starts with <ruby>', () => {
    expect(isHeadingLine('<ruby>駅<rt>えき</rt></ruby>に着いた。')).toBe(false);
  });

  it('rejects a line that starts with <rt>', () => {
    expect(isHeadingLine('<rt>えき</rt></ruby>に着いた。')).toBe(false);
  });

  it('rejects a line that starts with a closing tag', () => {
    expect(isHeadingLine('</ruby>に着いた。')).toBe(false);
  });

  it('rejects a ">>" line', () => {
    expect(isHeadingLine('>> 朝になった。')).toBe(false);
  });

  it('rejects a line with no marker', () => {
    expect(isHeadingLine('朝が来た。')).toBe(false);
  });

  it('rejects a line with whitespace before "<"', () => {
    expect(isHeadingLine(' < 朝が来た。')).toBe(false);
  });
});

describe('isSubItemLine', () => {
  it('accepts a line that starts with ">> "', () => {
    expect(isSubItemLine('>> 朝になった。')).toBe(true);
  });

  it('accepts a line that starts with ">>" and no space', () => {
    expect(isSubItemLine('>>朝になった。')).toBe(true);
  });

  it('rejects a line that starts with a single ">"', () => {
    expect(isSubItemLine('> 朝になった。')).toBe(false);
  });

  it('rejects a line with whitespace before ">>"', () => {
    expect(isSubItemLine(' >> 朝になった。')).toBe(false);
  });

  it('rejects full-width "＞＞"', () => {
    expect(isSubItemLine('＞＞ 朝になった。')).toBe(false);
  });
});

describe('removeSubItemPrefix', () => {
  it('removes ">>" and keeps the space after it', () => {
    expect(removeSubItemPrefix('>> 朝になった。')).toBe(' 朝になった。');
  });

  it('removes ">>" with no space after it', () => {
    expect(removeSubItemPrefix('>>朝になった。')).toBe('朝になった。');
  });

  it('removes only the first ">>"', () => {
    expect(removeSubItemPrefix('>>>> 朝になった。')).toBe('>> 朝になった。');
  });

  it('leaves a line with no ">>" unchanged', () => {
    expect(removeSubItemPrefix('朝になった。')).toBe('朝になった。');
  });
});

describe('removeHeadingPrefix', () => {
  it('removes "<" and keeps the space after it', () => {
    expect(removeHeadingPrefix('< 朝が来た。')).toBe(' 朝が来た。');
  });

  it('removes a full-width "＜"', () => {
    expect(removeHeadingPrefix('＜朝が来た。')).toBe('朝が来た。');
  });

  it('leaves a line that starts with <ruby> unchanged', () => {
    expect(removeHeadingPrefix('<ruby>駅<rt>えき</rt></ruby>')).toBe('<ruby>駅<rt>えき</rt></ruby>');
  });

  it('leaves a line that starts with <rt> unchanged', () => {
    expect(removeHeadingPrefix('<rt>えき</rt>')).toBe('<rt>えき</rt>');
  });

  it('leaves a line that starts with a closing tag unchanged', () => {
    expect(removeHeadingPrefix('</ruby>に着いた。')).toBe('</ruby>に着いた。');
  });

  it('leaves a line with no marker unchanged', () => {
    expect(removeHeadingPrefix('朝が来た。')).toBe('朝が来た。');
  });
});

describe('removeBoldFormatting', () => {
  it('removes "**" from both ends of a line', () => {
    expect(removeBoldFormatting('**朝が来た。**')).toBe('朝が来た。');
  });

  it('leaves a line with only an opening "**" unchanged', () => {
    expect(removeBoldFormatting('**朝が来た。')).toBe('**朝が来た。');
  });

  it('leaves a line with whitespace before "**" unchanged', () => {
    expect(removeBoldFormatting(' **朝が来た。**')).toBe(' **朝が来た。**');
  });

  it('leaves a line with no "**" unchanged', () => {
    expect(removeBoldFormatting('朝が来た。')).toBe('朝が来た。');
  });
});

describe('normalizeHeading', () => {
  it('removes "<" and trims the space after it', () => {
    expect(normalizeHeading('< 朝が来た。')).toBe('朝が来た。');
  });

  it('removes a full-width "＜"', () => {
    expect(normalizeHeading('＜朝が来た。')).toBe('朝が来た。');
  });

  it('removes "<" and then "**" bold markers written right after it', () => {
    expect(normalizeHeading('<**朝が来た。**')).toBe('朝が来た。');
  });

  it('removes "## " from a hash heading', () => {
    expect(normalizeHeading('## 第一章')).toBe('第一章');
  });

  it('removes a full-width "＃＃ " from a hash heading', () => {
    expect(normalizeHeading('＃＃ 第一章')).toBe('第一章');
  });

  it('trims surrounding whitespace from a line with no marker', () => {
    expect(normalizeHeading('  朝が来た。  ')).toBe('朝が来た。');
  });

  it.todo('removes "**" and "##" written after "< " in the spaced head format, e.g. "< **朝が来た。**" (bug)');
});

describe('hasEmbeddedHeading', () => {
  it('finds a full-width "＜" inside a line', () => {
    expect(hasEmbeddedHeading('>> 朝になった。＜雨が降る。')).toBe(true);
  });

  it('finds a "<" inside a line', () => {
    expect(hasEmbeddedHeading('>> 朝になった。<雨が降る。')).toBe(true);
  });

  it('finds a "<" that follows <ruby> markup', () => {
    expect(hasEmbeddedHeading('<ruby>駅<rt>えき</rt></ruby>だ。<雨が降る。')).toBe(true);
  });

  it('ignores <ruby>, <rt> and their closing tags', () => {
    expect(hasEmbeddedHeading('<ruby>駅<rt>えき</rt></ruby>に着いた。')).toBe(false);
  });

  it('ignores <rb> and its closing tag', () => {
    expect(hasEmbeddedHeading('<ruby><rb>駅</rb><rt>えき</rt></ruby>')).toBe(false);
  });

  it('finds nothing in a line with no "<"', () => {
    expect(hasEmbeddedHeading('朝が来た。')).toBe(false);
  });
});
