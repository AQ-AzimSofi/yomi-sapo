'use client';

import { useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  COLORS,
  READER_CONFIG,
  STORAGE_KEYS,
  THEME,
  type PriorityScore,
} from '@/lib/constants';
import ProgressBar from './components/ProgressBar';
import ReaderFAB from './components/ReaderFAB';
import CopyRangeModal from './components/CopyRangeModal';
import ReaderSettings from './components/ReaderSettings';
import ReadingContent from './components/ReadingContent';
import ReaderHeader from './components/ReaderHeader';
import BottomSheet from '@/app/components/ui/BottomSheet';
import { useBookMetadata } from '@/app/hooks/useBookMetadata';
import { useGuestMode } from '@/app/hooks/useGuestMode';
import GuestModeBanner from '@/app/components/ui/GuestModeBanner';
import { stripFurigana } from '@/lib/utils/furiganaParser';
import {
  detectContentType,
  locateBookmark,
  pageOfIndex,
  pageStartIndex,
  parseReaderItems,
  toPlayableUnits,
  totalPagesFor,
} from '@/lib/content/bookModel';
import { useAudioBook } from '@/app/hooks/useAudioBook';
import { useNarration } from '@/app/hooks/useNarration';
import { useOpenedOnce } from '@/app/hooks/useOpenedOnce';
import { ApiError, fetchBookText, fetchBookmark, prioritize, saveBookmark } from '@/lib/api/client';
import { bookRefFromParams, rubyRegistryKey, toBookKey } from '@/lib/books/bookRef';
import { describeLoadFailure } from './loadFailure';
import { applyReaderTheme, readerThemeFrom, storedDarkModeFor, type ReaderTheme } from './readerTheme';
import type { AudioBookContentMode } from '@/lib/types';

const ExplanationSidebar = dynamic(
  () => import('@/app/components/reading/ExplanationSidebar'),
  { ssr: false }
);

const RubyLookupSidebar = dynamic(
  () => import('@/app/components/reading/RubyLookupSidebar'),
  { ssr: false }
);

const FloatingStickyNotes = dynamic(
  () => import('./components/FloatingStickyNotes'),
  { ssr: false }
);

const AudioPlayerBar = dynamic(
  () => import('./components/AudioPlayerBar'),
  { ssr: false }
);

const GuestApiKeyModal = dynamic(
  () => import('@/app/components/reading/GuestApiKeyModal'),
  { ssr: false }
);

const PRIORITIZE_ERROR_MESSAGE = 'このページを分析できませんでした。もう一度お試しください。';

function SearchParamsReader({
  children,
}: {
  children: (params: { directory: string | null; fileName: string | null; page: number; hasExplicitPage: boolean }) => React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const directory = searchParams.get('directory');
  const fileName = searchParams.get('fileName');
  const hasExplicitPage = searchParams.has('page');
  const page = parseInt(searchParams.get('page') || '1', 10);

  return <>{children({ directory, fileName, page, hasExplicitPage })}</>;
}

function ReaderContent({
  directoryParam,
  fileNameParam,
  pageParam,
  hasExplicitPage,
}: {
  directoryParam: string | null;
  fileNameParam: string | null;
  pageParam: number;
  hasExplicitPage: boolean;
}) {
  const router = useRouter();

  const [content, setContent] = useState<string>('');
  const [bookmarkText, setBookmarkText] = useState<string>('');
  const [bookmarkSavedPage, setBookmarkSavedPage] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showFurigana, setShowFurigana] = useState(false);
  const [fontSize, setFontSize] = useState<number>(READER_CONFIG.DEFAULT_FONT_SIZE);
  const [lineHeight, setLineHeight] = useState<number>(READER_CONFIG.DEFAULT_LINE_HEIGHT);
  const [displayMode, setDisplayMode] = useState<'collapsed' | 'expanded'>('collapsed');
  const [showRephrase, setShowRephrase] = useState(false);
  const [aiExplanationEnabled, setAiExplanationEnabled] = useState(false);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light');
  const isDarkMode = readerTheme === 'dark';

  const [audiobookEnabled, setAudiobookEnabled] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [contentMode, setContentMode] = useState<AudioBookContentMode>('main');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [rubyLookupOpen, setRubyLookupOpen] = useState(false);
  const [selectedSentence, setSelectedSentence] = useState('');
  const [sentenceContext, setSentenceContext] = useState('');

  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyRangeOpen, setCopyRangeOpen] = useState(false);
  const [copyRangeFeedback, setCopyRangeFeedback] = useState(false);

  const [priorityScores, setPriorityScores] = useState<Record<number, PriorityScore>>({});
  const [isPrioritizing, setIsPrioritizing] = useState(false);
  const [prioritizeError, setPrioritizeError] = useState<string | null>(null);

  const book = useMemo(
    () => (fileNameParam ? bookRefFromParams(directoryParam, fileNameParam) : null),
    [directoryParam, fileNameParam]
  );
  const { imageMap } = useBookMetadata(book);
  const { isGuest } = useGuestMode();
  const hasOpenedExplanation = useOpenedOnce(explanationOpen);
  const hasOpenedRubyLookup = useOpenedOnce(rubyLookupOpen);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedFurigana = localStorage.getItem(STORAGE_KEYS.FURIGANA_ENABLED);
    if (storedFurigana) setShowFurigana(storedFurigana === 'true');

    const storedFontSize = localStorage.getItem(STORAGE_KEYS.READER_FONT_SIZE);
    if (storedFontSize) setFontSize(parseInt(storedFontSize, 10));

    const storedLineHeight = localStorage.getItem(STORAGE_KEYS.READER_LINE_HEIGHT);
    if (storedLineHeight) setLineHeight(parseFloat(storedLineHeight));

    const storedAiExplanation = localStorage.getItem(STORAGE_KEYS.AI_EXPLANATION_ENABLED);
    if (storedAiExplanation) setAiExplanationEnabled(storedAiExplanation === 'true');

    const storedShowRephrase = localStorage.getItem(STORAGE_KEYS.SHOW_REPHRASE);
    if (storedShowRephrase) {
      const isExpanded = storedShowRephrase === 'true';
      setShowRephrase(isExpanded);
      setDisplayMode(isExpanded ? 'expanded' : 'collapsed');
    }

    setReaderTheme(readerThemeFrom(localStorage.getItem(STORAGE_KEYS.READER_DARK_MODE)));

    const storedAudiobook = localStorage.getItem(STORAGE_KEYS.AUDIOBOOK_ENABLED);
    if (storedAudiobook) setAudiobookEnabled(storedAudiobook === 'true');

    const storedContentMode = localStorage.getItem(STORAGE_KEYS.AUDIOBOOK_CONTENT_MODE);
    if (storedContentMode === 'main' || storedContentMode === 'sub' || storedContentMode === 'both') {
      setContentMode(storedContentMode);
    }
  }, []);

  useEffect(() => applyReaderTheme(document, readerTheme), [readerTheme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setRubyLookupOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!book) {
      router.push('/library');
      return;
    }

    const controller = new AbortController();

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      // Keeping the previous book's text would leave every derived value - unit
      // count, page count, narration lookup - describing the book we just left.
      setContent('');
      setBookmarkText('');
      setBookmarkSavedPage(null);

      try {
        const [bookText, bookmark] = await Promise.all([
          fetchBookText(book, controller.signal),
          fetchBookmark(book, controller.signal),
        ]);

        if (controller.signal.aborted) return;
        setContent(bookText);

        if (bookmark) {
          setBookmarkText(bookmark.text || '');
          setBookmarkSavedPage(bookmark.page ?? null);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(describeLoadFailure(err));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    fetchData();
    // A late response from the book we just left would otherwise overwrite the
    // new book's text, and narration would then be keyed on the wrong unit count.
    return () => controller.abort();
  }, [book, router]);

  // The book is parsed once here; ReadingContent renders these same items.
  const readerItems = useMemo(() => parseReaderItems(content), [content]);
  const contentType = useMemo(() => detectContentType(content), [content]);
  const playableUnits = useMemo(() => toPlayableUnits(readerItems), [readerItems]);
  const unitMainTexts = useMemo(() => playableUnits.map(unit => unit.main), [playableUnits]);
  const totalItems = playableUnits.length;

  const totalPages = totalPagesFor(totalItems);
  const currentPage = Math.min(Math.max(1, pageParam), totalPages || 1);
  const progress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;

  const currentPageHeaders = useMemo(
    () => unitMainTexts.slice(pageStartIndex(currentPage), pageStartIndex(currentPage + 1)).map(stripFurigana),
    [unitMainTexts, currentPage]
  );

  // Priority scores are per-page; drop them (and any error) on page/book change.
  useEffect(() => {
    setPriorityScores({});
    setPrioritizeError(null);
  }, [currentPage, book]);

  useEffect(() => {
    if (!prioritizeError) return;
    const timer = setTimeout(() => setPrioritizeError(null), 4000);
    return () => clearTimeout(timer);
  }, [prioritizeError]);

  const handlePrioritize = useCallback(async () => {
    if (isPrioritizing || currentPageHeaders.length === 0) return;
    if (Object.keys(priorityScores).length > 0) {
      setPriorityScores({});
      return;
    }

    setPrioritizeError(null);
    setIsPrioritizing(true);
    try {
      const data = await prioritize(currentPageHeaders);
      const scores = Array.isArray(data.scores) ? data.scores : [];
      const start = pageStartIndex(currentPage);
      setPriorityScores(
        Object.fromEntries(scores.map((score, index) => [start + index, score] as const))
      );
    } catch (err) {
      // A 401 is a guest without a key, and it opened the key modal; anything else
      // is a real failure the reader should see rather than a silent empty result.
      if (err instanceof ApiError && err.status === 401) return;
      setPrioritizeError(PRIORITIZE_ERROR_MESSAGE);
    } finally {
      setIsPrioritizing(false);
    }
  }, [currentPageHeaders, currentPage, priorityScores, isPrioritizing]);

  const bookmarkLocation = useMemo(
    () => locateBookmark(unitMainTexts, bookmarkText, bookmarkSavedPage),
    [bookmarkText, bookmarkSavedPage, unitMainTexts]
  );
  const bookmarkItemIndex = bookmarkLocation.unitIndex;
  const bookmarkPage = bookmarkLocation.page;

  const getStartIndex = useCallback(() => {
    const pageTop = pageStartIndex(currentPage);
    if (bookmarkItemIndex == null) return pageTop;
    return pageOfIndex(bookmarkItemIndex) === currentPage ? bookmarkItemIndex : pageTop;
  }, [currentPage, bookmarkItemIndex]);

  const { manifest: narration, error: narrationLoadError } = useNarration(book, totalItems);

  const {
    status: audioStatus,
    index: audioIndex,
    cursor: audioStartCursor,
    total: audioTotal,
    speed: audioSpeed,
    hasNarration,
    playbackError,
    togglePlayPause,
    next: audioNext,
    previous: audioPrev,
    replay: audioReplay,
    playSub: audioPlaySub,
    setStartCursor,
    setSpeed: setAudioSpeed,
    stop: stopAudioBook,
  } = useAudioBook({
    units: playableUnits,
    contentMode,
    narration,
    getStartIndex,
  });

  const buildReadHref = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      if (directoryParam) params.set('directory', directoryParam);
      if (fileNameParam) params.set('fileName', fileNameParam);
      params.set('page', page.toString());
      return `/read?${params.toString()}`;
    },
    [directoryParam, fileNameParam]
  );

  // The whole book is already loaded, so a page change only needs the URL.
  // Next keeps useSearchParams in sync with the History API, and skipping the
  // router avoids a server round trip on every page turn.
  const navigateToPage = useCallback(
    (page: number, { replace }: { replace: boolean }) => {
      const href = buildReadHref(page);
      if (replace) {
        window.history.replaceState(null, '', href);
        return;
      }
      window.history.pushState(null, '', href);
    },
    [buildReadHref]
  );

  const [didAutoNavigate, setDidAutoNavigate] = useState(false);

  useEffect(() => {
    if (isLoading || didAutoNavigate) return;
    if (!hasExplicitPage && bookmarkPage && bookmarkPage > 1 && currentPage !== bookmarkPage) {
      setDidAutoNavigate(true);
      navigateToPage(bookmarkPage, { replace: true });
    }
  }, [isLoading, hasExplicitPage, bookmarkPage, currentPage, navigateToPage, didAutoNavigate]);

  useEffect(() => {
    if (isLoading) return;
    if (audiobookEnabled && audioStatus !== 'idle') return;

    const scrollToBookmark = () => {
      const bookmarkElement = document.getElementById('bookmark');
      if (bookmarkElement) {
        bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    const timer = setTimeout(scrollToBookmark, 100);
    return () => clearTimeout(timer);
  }, [currentPage, isLoading, bookmarkText, audiobookEnabled, audioStatus]);

  useEffect(() => {
    if (!audiobookEnabled || audioIndex < 0) return;
    const targetPage = pageOfIndex(audioIndex);
    if (targetPage === currentPage) return;
    navigateToPage(targetPage, { replace: true });
  }, [audioIndex, audiobookEnabled, currentPage, navigateToPage]);

  useEffect(() => {
    if (!audiobookEnabled || audioIndex < 0) return;
    const targetPage = pageOfIndex(audioIndex);
    if (targetPage !== currentPage) return;
    const timer = setTimeout(() => {
      const activeItem = document.querySelector(`[data-global-index="${audioIndex}"]`);
      if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => clearTimeout(timer);
  }, [audioIndex, audiobookEnabled, currentPage]);

  const refetchBookmark = useCallback(async () => {
    if (!book) return;
    try {
      const bookmark = await fetchBookmark(book);
      if (!bookmark) return;
      setBookmarkText(bookmark.text || '');
      setBookmarkSavedPage(bookmark.page ?? null);
    } catch (err) {
      console.error('Failed to refetch bookmark:', err);
    }
  }, [book]);

  const bookmarkPlayingSentence = useCallback(async () => {
    if (!book || audioStatus === 'idle' || audioIndex < 0) return;
    const unit = playableUnits[audioIndex];
    if (!unit) return;
    const page = pageOfIndex(audioIndex);
    try {
      await saveBookmark({ ...book, content: unit.main, page });
      refetchBookmark();
    } catch (err) {
      console.error('Failed to bookmark playing sentence:', err);
    }
  }, [book, audioStatus, audioIndex, playableUnits, refetchBookmark]);

  useEffect(() => {
    if (!audiobookEnabled || !keyboardMode) return;

    const keyActions: Record<string, () => void> = {
      ArrowUp: togglePlayPause,
      ArrowRight: audioNext,
      ArrowLeft: audioPrev,
      ArrowDown: audioReplay,
      // The same JIS key types "\" on Windows and "_" on macOS.
      '\\': audioPlaySub,
      _: audioPlaySub,
      b: bookmarkPlayingSentence,
      B: bookmarkPlayingSentence,
    };

    const handleAudioKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (settingsOpen || explanationOpen || rubyLookupOpen) return;
      if (e.key === 'Escape') {
        setKeyboardMode(false);
        return;
      }
      const action = keyActions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };

    window.addEventListener('keydown', handleAudioKey);
    return () => window.removeEventListener('keydown', handleAudioKey);
  }, [audiobookEnabled, keyboardMode, settingsOpen, explanationOpen, rubyLookupOpen, togglePlayPause, audioNext, audioPrev, audioReplay, audioPlaySub, bookmarkPlayingSentence]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage < 1 || newPage > totalPages) return;
      stopAudioBook();
      navigateToPage(newPage, { replace: false });
      window.scrollTo(0, 0);
    },
    [totalPages, navigateToPage, stopAudioBook]
  );

  const handleToggleFurigana = () => {
    const newValue = !showFurigana;
    setShowFurigana(newValue);
    localStorage.setItem(STORAGE_KEYS.FURIGANA_ENABLED, newValue.toString());
  };

  const handleFontSizeChange = (size: number) => {
    setFontSize(size);
    localStorage.setItem(STORAGE_KEYS.READER_FONT_SIZE, size.toString());
  };

  const handleLineHeightChange = (height: number) => {
    setLineHeight(height);
    localStorage.setItem(STORAGE_KEYS.READER_LINE_HEIGHT, height.toString());
  };

  const handleDisplayModeChange = (mode: 'collapsed' | 'expanded') => {
    setDisplayMode(mode);
    setShowRephrase(mode === 'expanded');
    localStorage.setItem(STORAGE_KEYS.SHOW_REPHRASE, (mode === 'expanded').toString());
  };

  const handleToggleRephrase = () => {
    const newShowRephrase = !showRephrase;
    setShowRephrase(newShowRephrase);
    setDisplayMode(newShowRephrase ? 'expanded' : 'collapsed');
    localStorage.setItem(STORAGE_KEYS.SHOW_REPHRASE, newShowRephrase.toString());
  };

  const handleAiExplanationChange = (enabled: boolean) => {
    setAiExplanationEnabled(enabled);
    localStorage.setItem(STORAGE_KEYS.AI_EXPLANATION_ENABLED, enabled.toString());
  };

  const handleToggleDarkMode = () => {
    const nextTheme = isDarkMode ? 'light' : 'dark';
    setReaderTheme(nextTheme);
    localStorage.setItem(STORAGE_KEYS.READER_DARK_MODE, storedDarkModeFor(nextTheme));
  };

  const handleAudiobookChange = (enabled: boolean) => {
    setAudiobookEnabled(enabled);
    localStorage.setItem(STORAGE_KEYS.AUDIOBOOK_ENABLED, enabled.toString());
    if (!enabled) {
      stopAudioBook();
      setKeyboardMode(false);
    }
  };

  const handleContentModeChange = (mode: AudioBookContentMode) => {
    setContentMode(mode);
    localStorage.setItem(STORAGE_KEYS.AUDIOBOOK_CONTENT_MODE, mode);
  };

  const handleToggleKeyboardMode = () => {
    setKeyboardMode(prev => !prev);
  };

  const handleSentenceClick = (sentence: string) => {
    if (!aiExplanationEnabled) return;

    const cleanSentence = stripFurigana(sentence).trim();
    setSelectedSentence(sentence);
    setSentenceContext(cleanSentence);
    setExplanationOpen(true);
  };


  const handleGoToBookmark = useCallback(() => {
    if (!bookmarkPage) return;

    if (currentPage === bookmarkPage) {
      const bookmarkElement = document.getElementById('bookmark');
      if (bookmarkElement) {
        bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      handlePageChange(bookmarkPage);
    }
  }, [bookmarkPage, currentPage, handlePageChange]);

  const handleCopyPageText = useCallback(async () => {
    if (currentPageHeaders.length === 0) return;

    try {
      const textToCopy = currentPageHeaders.join('\n');
      await navigator.clipboard.writeText(textToCopy);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [currentPageHeaders]);

  const handleCopyPageRange = useCallback(async (fromPage: number, toPage: number) => {
    const textToCopy = unitMainTexts
      .slice(pageStartIndex(fromPage), pageStartIndex(toPage + 1))
      .map(stripFurigana)
      .join('\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyRangeFeedback(true);
      setTimeout(() => {
        setCopyRangeFeedback(false);
        setCopyRangeOpen(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [unitMainTexts]);

  // Without a book the reader is on its way back to the library.
  if (isLoading || !book) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: THEME.READER_BG }}
      >
        <div
          className="w-10 h-10 rounded-full animate-spin"
          style={{
            borderWidth: '2px',
            borderStyle: 'solid',
            borderColor: THEME.NEUTRAL,
            borderTopColor: THEME.INK,
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: THEME.READER_BG }}
      >
        <div
          className="p-8 text-center max-w-md border"
          style={{
            backgroundColor: THEME.SURFACE,
            borderColor: THEME.NEUTRAL,
          }}
        >
          <p className="font-mincho font-bold text-lg mb-2" style={{ color: THEME.INK }}>
            本を読み込めませんでした
          </p>
          <p className="text-sm mb-5" style={{ color: THEME.SECONDARY }}>
            {error}
          </p>
          <button
            onClick={() => router.push('/library')}
            className="min-h-11 px-5 text-sm font-bold interactive-btn"
            style={{ backgroundColor: THEME.PRIMARY, color: THEME.ON_PRIMARY }}
          >
            本棚に戻る
          </button>
        </div>
      </div>
    );
  }

  const hasBookmark = bookmarkPage != null && bookmarkPage > 0;
  const registryKey = rubyRegistryKey(book);

  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{ backgroundColor: THEME.READER_BG, color: THEME.INK }}
    >
      {isGuest && (
        <GuestModeBanner
          message="Preview only. Sign in to read the full book and use your saved bookmarks."
        />
      )}

      {isPrioritizing && (
        <div
          style={{
            position: 'fixed',
            bottom: audiobookEnabled ? 150 : 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            backgroundColor: THEME.SURFACE,
            color: THEME.INK,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            border: `1px solid ${THEME.NEUTRAL}`,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span
            className="animate-spin"
            style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: COLORS.START_CURSOR, borderTopColor: 'transparent', borderRadius: '50%' }}
          />
          重要度を分析中…
        </div>
      )}

      {prioritizeError && !isPrioritizing && (
        <div
          style={{
            position: 'fixed',
            bottom: audiobookEnabled ? 150 : 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            padding: '8px 16px',
            backgroundColor: THEME.SURFACE,
            color: THEME.DANGER,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            border: `1px solid ${THEME.DANGER}`,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {prioritizeError}
        </div>
      )}

      <ProgressBar progress={progress} />

      <ReaderHeader
        currentPage={currentPage}
        totalPages={totalPages}
        bookmarkPage={bookmarkPage}
        directoryParam={directoryParam}
        fileNameParam={fileNameParam}
        onPageChange={handlePageChange}
      />

      <main
        className="max-w-3xl mx-auto px-4 py-8 pt-4 pb-12"
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
          paddingBottom: audiobookEnabled ? 140 : undefined,
        }}
      >
        <ReadingContent
          items={readerItems}
          contentType={contentType}
          book={book}
          bookmarkIndex={bookmarkItemIndex}
          showFurigana={showFurigana}
          displayMode={displayMode}
          aiExplanationEnabled={aiExplanationEnabled}
          currentPage={currentPage}
          onBookmarkSuccess={refetchBookmark}
          onSentenceClick={handleSentenceClick}
          imageMap={imageMap}
          audiobookEnabled={audiobookEnabled}
          startCursorIndex={audioStartCursor}
          playingIndex={audioStatus === 'idle' ? -1 : audioIndex}
          onStartFromHere={setStartCursor}
          priorityScores={priorityScores}
        />

        {totalPages > 1 && (
          <div
            className="flex justify-between items-center gap-4 mt-10 pt-5 border-t font-gothic"
            style={{ borderColor: THEME.NEUTRAL }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePageChange(currentPage - 1);
              }}
              disabled={currentPage <= 1}
              className="min-h-11 px-4 border disabled:opacity-30 text-sm interactive-page-btn"
              style={{ borderColor: THEME.NEUTRAL, color: THEME.INK }}
            >
              前のページ
            </button>
            <span className="text-sm" style={{ color: THEME.SECONDARY }}>
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePageChange(currentPage + 1);
              }}
              disabled={currentPage >= totalPages}
              className="min-h-11 px-4 border disabled:opacity-30 text-sm font-bold interactive-page-btn"
              style={{ borderColor: THEME.INK, color: THEME.INK }}
            >
              次のページ
            </button>
          </div>
        )}

        {isGuest && (
          <div
            className="mt-10 p-6 text-center font-gothic"
            style={{ backgroundColor: THEME.SURFACE_MUTED, border: `1px solid ${THEME.NEUTRAL}` }}
          >
            <p className="text-base font-semibold mb-1" style={{ color: THEME.INK }}>
              End of preview
            </p>
            <p className="text-sm mb-4" style={{ color: THEME.SECONDARY }}>
              You are reading a free sample. Sign in to read the full book.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="min-h-11 px-5 text-sm font-bold interactive-btn"
              style={{ backgroundColor: THEME.PRIMARY, color: THEME.ON_PRIMARY }}
            >
              Sign in
            </button>
          </div>
        )}
      </main>

      <ReaderFAB
        onToggleFurigana={handleToggleFurigana}
        onToggleRephrase={handleToggleRephrase}
        onOpenSettings={() => setSettingsOpen(true)}
        onGoToBookmark={handleGoToBookmark}
        onCopyPageText={handleCopyPageText}
        onCopyPageRange={() => setCopyRangeOpen(true)}
        onToggleDarkMode={handleToggleDarkMode}
        onToggleRubyLookup={() => setRubyLookupOpen(prev => !prev)}
        onPrioritize={handlePrioritize}
        isPrioritizing={isPrioritizing}
        hasPriority={Object.keys(priorityScores).length > 0}
        isFuriganaEnabled={showFurigana}
        showRephrase={showRephrase}
        isDarkMode={isDarkMode}
        hasBookmark={hasBookmark}
        bookmarkPage={bookmarkPage}
        currentPage={currentPage}
        copyFeedback={copyFeedback}
      />

      <CopyRangeModal
        isOpen={copyRangeOpen}
        onClose={() => setCopyRangeOpen(false)}
        onCopy={handleCopyPageRange}
        currentPage={currentPage}
        totalPages={totalPages}
        copyFeedback={copyRangeFeedback}
      />

      <BottomSheet isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="Display">
        <ReaderSettings
          fontSize={fontSize}
          lineHeight={lineHeight}
          displayMode={displayMode}
          aiExplanationEnabled={aiExplanationEnabled}
          onFontSizeChange={handleFontSizeChange}
          onLineHeightChange={handleLineHeightChange}
          onDisplayModeChange={handleDisplayModeChange}
          onAiExplanationChange={handleAiExplanationChange}
          audiobookEnabled={audiobookEnabled}
          onAudiobookChange={handleAudiobookChange}
        />
      </BottomSheet>

      {hasOpenedExplanation && (
        <ExplanationSidebar
          isOpen={explanationOpen}
          onClose={() => setExplanationOpen(false)}
          sentence={selectedSentence}
          context={sentenceContext}
          fileName={toBookKey(book)}
          showFurigana={showFurigana}
        />
      )}

      {hasOpenedRubyLookup && (
        <RubyLookupSidebar
          isOpen={rubyLookupOpen}
          onClose={() => setRubyLookupOpen(false)}
          directory={registryKey.directory}
          bookName={registryKey.bookName}
        />
      )}

      <FloatingStickyNotes directory={registryKey.directory} bookName={registryKey.bookName} />

      {audiobookEnabled && (
        <AudioPlayerBar
          status={audioStatus}
          index={audioIndex}
          total={audioTotal}
          contentMode={contentMode}
          speed={audioSpeed}
          keyboardMode={keyboardMode}
          hasNarration={hasNarration}
          playbackError={playbackError ?? narrationLoadError}
          onTogglePlay={togglePlayPause}
          onPrev={audioPrev}
          onNext={audioNext}
          onReplay={audioReplay}
          onContentModeChange={handleContentModeChange}
          onSpeedChange={setAudioSpeed}
          onToggleKeyboardMode={handleToggleKeyboardMode}
          onClose={() => handleAudiobookChange(false)}
        />
      )}

      {/* Always mounted: a failed session check reports a guest as signed in, and the key prompt must still reach them. */}
      <GuestApiKeyModal />
    </div>
  );
}

export default function ReadPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: THEME.READER_BG }}
        >
          <div
            className="w-10 h-10 border-2 rounded-full animate-spin"
            style={{
              borderColor: THEME.NEUTRAL,
              borderTopColor: THEME.INK,
            }}
          />
        </div>
      }
    >
      <SearchParamsReader>
        {({ directory, fileName, page, hasExplicitPage }) => (
          <ReaderContent
            directoryParam={directory}
            fileNameParam={fileName}
            pageParam={page}
            hasExplicitPage={hasExplicitPage}
          />
        )}
      </SearchParamsReader>
    </Suspense>
  );
}
