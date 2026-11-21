import type { FabAction } from './components/ReaderFAB';

interface ReaderMenuState {
  bookmarkPage: number | null;
  currentPage: number;
  copyFeedback: boolean;
  isPrioritizing: boolean;
  hasPriority: boolean;
  showRephrase: boolean;
  showFurigana: boolean;
  isDarkMode: boolean;
}

interface ReaderMenuHandlers {
  goToBookmark: () => void;
  copyPage: () => void;
  openCopyRange: () => void;
  prioritize: () => void;
  toggleRephrase: () => void;
  toggleFurigana: () => void;
  toggleRubyLookup: () => void;
  toggleDarkMode: () => void;
  openSettings: () => void;
}

function prioritizeLabel({ hasPriority, isPrioritizing }: ReaderMenuState): string {
  if (hasPriority) return '重要度を消す';
  if (isPrioritizing) return '分析中…';
  return '重要度を分析';
}

function bookmarkActions(state: ReaderMenuState, goToBookmark: () => void): FabAction[] {
  const { bookmarkPage, currentPage } = state;
  if (bookmarkPage == null || bookmarkPage <= 0) return [];
  const isOnBookmarkPage = currentPage === bookmarkPage;
  return [{
    id: 'bookmark',
    icon: 'bookmark',
    label: isOnBookmarkPage ? '栞の位置へ' : `栞のページへ (p.${bookmarkPage})`,
    onSelect: goToBookmark,
    active: isOnBookmarkPage,
  }];
}

/** The reader menu, top to bottom. Adding a tool to the menu means adding its entry here. */
export function readerMenuActions(state: ReaderMenuState, handlers: ReaderMenuHandlers): FabAction[] {
  return [
    ...bookmarkActions(state, handlers.goToBookmark),
    {
      id: 'copyPage',
      icon: 'copyPage',
      label: state.copyFeedback ? 'コピーしました' : 'ページをコピー',
      onSelect: handlers.copyPage,
      active: state.copyFeedback,
      keepMenuOpen: true,
    },
    { id: 'copyRange', icon: 'copyRange', label: '範囲をコピー', onSelect: handlers.openCopyRange },
    {
      id: 'prioritize',
      icon: state.isPrioritizing ? 'busy' : 'prioritize',
      label: prioritizeLabel(state),
      onSelect: handlers.prioritize,
      active: state.hasPriority,
    },
    {
      id: 'rephrase',
      icon: 'rephrase',
      label: state.showRephrase ? 'やさしい文を隠す' : 'やさしい文を表示',
      onSelect: handlers.toggleRephrase,
      active: state.showRephrase,
    },
    { id: 'furigana', icon: 'furigana', label: 'ふりがな', onSelect: handlers.toggleFurigana, active: state.showFurigana },
    { id: 'rubyLookup', icon: 'rubyLookup', label: 'ルビ検索', onSelect: handlers.toggleRubyLookup },
    {
      id: 'theme',
      icon: state.isDarkMode ? 'lightMode' : 'darkMode',
      label: state.isDarkMode ? 'ライトモード' : 'ダークモード',
      onSelect: handlers.toggleDarkMode,
      active: state.isDarkMode,
    },
    { id: 'settings', icon: 'settings', label: '表示設定', onSelect: handlers.openSettings },
  ];
}
