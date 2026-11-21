import { describe, expect, it, vi } from 'vitest';
import { readerMenuActions } from './readerMenuActions';

type MenuState = Parameters<typeof readerMenuActions>[0];

const QUIET_STATE: MenuState = {
  bookmarkPage: 1,
  currentPage: 1,
  copyFeedback: false,
  isPrioritizing: false,
  hasPriority: false,
  showRephrase: false,
  showFurigana: false,
  isDarkMode: false,
};

function noopHandlers() {
  return {
    goToBookmark: vi.fn(),
    copyPage: vi.fn(),
    openCopyRange: vi.fn(),
    prioritize: vi.fn(),
    toggleRephrase: vi.fn(),
    toggleFurigana: vi.fn(),
    toggleRubyLookup: vi.fn(),
    toggleDarkMode: vi.fn(),
    openSettings: vi.fn(),
  };
}

function labelsFor(state: Partial<MenuState>) {
  return readerMenuActions({ ...QUIET_STATE, ...state }, noopHandlers()).map((action) => action.label);
}

function idsFor(state: Partial<MenuState>) {
  return readerMenuActions({ ...QUIET_STATE, ...state }, noopHandlers()).map((action) => action.id);
}

function activeLabelsFor(state: Partial<MenuState>) {
  return readerMenuActions({ ...QUIET_STATE, ...state }, noopHandlers())
    .filter((action) => action.active)
    .map((action) => action.label);
}

describe('readerMenuActions', () => {
  it('lists the reader tools in the menu order', () => {
    expect(labelsFor({})).toStrictEqual([
      '栞の位置へ',
      'ページをコピー',
      '範囲をコピー',
      '重要度を分析',
      'やさしい文を表示',
      'ふりがな',
      'ルビ検索',
      'ダークモード',
      '表示設定',
    ]);
  });

  it('points to the bookmark page from another page', () => {
    expect(labelsFor({ bookmarkPage: 3 })[0]).toBe('栞のページへ (p.3)');
  });

  it('marks the bookmark entry active only on the bookmark page', () => {
    expect([activeLabelsFor({}), activeLabelsFor({ bookmarkPage: 3 })]).toStrictEqual([['栞の位置へ'], []]);
  });

  it.each([null, 0])('leaves the bookmark entry out when the bookmark page is %s', (bookmarkPage) => {
    expect(idsFor({ bookmarkPage })).not.toContain('bookmark');
  });

  it('labels and marks the switches that are on', () => {
    expect(activeLabelsFor({ bookmarkPage: null, showRephrase: true, showFurigana: true, isDarkMode: true })).toStrictEqual([
      'やさしい文を隠す',
      'ふりがな',
      'ライトモード',
    ]);
  });

  it('confirms a page copy in place', () => {
    expect(activeLabelsFor({ bookmarkPage: null, copyFeedback: true })).toStrictEqual(['コピーしました']);
  });

  it('keeps the menu open only for the page copy', () => {
    const kept = readerMenuActions(QUIET_STATE, noopHandlers()).filter((action) => action.keepMenuOpen);

    expect(kept.map((action) => action.id)).toStrictEqual(['copyPage']);
  });

  it('shows the analysis in progress with a busy icon', () => {
    const prioritize = readerMenuActions({ ...QUIET_STATE, isPrioritizing: true }, noopHandlers())
      .find((action) => action.id === 'prioritize');

    expect([prioritize?.label, prioritize?.icon]).toStrictEqual(['分析中…', 'busy']);
  });

  it('offers to clear the scores once a page is analyzed', () => {
    expect(activeLabelsFor({ bookmarkPage: null, hasPriority: true })).toStrictEqual(['重要度を消す']);
  });

  it('switches the theme icon to the theme it would turn on', () => {
    const themeIcons = [false, true].map((isDarkMode) =>
      readerMenuActions({ ...QUIET_STATE, isDarkMode }, noopHandlers()).find((action) => action.id === 'theme')?.icon
    );

    expect(themeIcons).toStrictEqual(['darkMode', 'lightMode']);
  });

  it.each([
    ['bookmark', 'goToBookmark'],
    ['copyPage', 'copyPage'],
    ['copyRange', 'openCopyRange'],
    ['prioritize', 'prioritize'],
    ['rephrase', 'toggleRephrase'],
    ['furigana', 'toggleFurigana'],
    ['rubyLookup', 'toggleRubyLookup'],
    ['theme', 'toggleDarkMode'],
    ['settings', 'openSettings'],
  ])('selecting %s calls only its handler %s', (id, handlerName) => {
    const handlers = noopHandlers();

    readerMenuActions(QUIET_STATE, handlers).find((action) => action.id === id)?.onSelect();

    const called = Object.entries(handlers).filter(([, handler]) => handler.mock.calls.length > 0).map(([name]) => name);
    expect(called).toStrictEqual([handlerName]);
  });

  it('marks no entry as beta, the importance analysis included', () => {
    const marked = readerMenuActions(QUIET_STATE, noopHandlers()).filter((action) => 'beta' in action);

    expect(marked.map((action) => action.id)).toStrictEqual([]);
  });
});
