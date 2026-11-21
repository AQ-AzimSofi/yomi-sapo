'use client';

import * as React from 'react';
import { EXPLANATION_CONFIG, EXPLANATION_MODE_CONFIG, THEME } from '@/lib/constants';
import { useExplanationCache } from '@/app/hooks/useExplanationCache';
import { useEscapeKey } from '@/app/hooks/useEscapeKey';
import { parseFurigana, segmentsToHTML, stripAiFurigana } from '@/lib/utils/furiganaParser';
import { renderSafeMarkdown } from '@/lib/utils/safeMarkdown';
import { toTint } from '@/lib/utils/colorTint';
import { GUEST_KEY_UPDATED_EVENT } from '@/lib/guestKeys';
import { explainSentence } from '@/lib/api/client';
import type { ExplanationMode } from '@/lib/constants';
import type { SentenceSurroundings } from '@/lib/content/explanationContext';
import { IDLE_EXPLANATION, nextExplanationDisplay } from './explanationDisplay';
import { askForExplanation } from './explanationRequest';
import { contextSizeToCommit, isSliderStepKey } from './contextSlider';

interface ExplanationSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sentence: string;
  surroundings: SentenceSurroundings;
  fileName: string;
  showFurigana?: boolean;
}

// Shared across mounts, so a sidebar that is closed and reopened, or mounted
// twice in development, joins the request already out instead of paying again.
const pendingExplanations = new Map<string, Promise<string>>();

export default function ExplanationSidebar({
  isOpen,
  onClose,
  sentence,
  surroundings,
  fileName,
  showFurigana = true,
}: ExplanationSidebarProps) {
  const [display, dispatchDisplay] = React.useReducer(nextExplanationDisplay, IDLE_EXPLANATION);
  const requestCountRef = React.useRef(0);
  const [draftContextSize, setDraftContextSize] = React.useState<number | null>(null);

  const [touchStart, setTouchStart] = React.useState<number>(0);
  const [touchEnd, setTouchEnd] = React.useState<number>(0);
  const [isDragging, setIsDragging] = React.useState<boolean>(false);
  const [dragOffset, setDragOffset] = React.useState<number>(0);

  const {
    getCache,
    setCache,
    contextSize,
    setContextSize,
    mode,
    setMode,
    contextSizeExpanded,
    setContextSizeExpanded,
  } = useExplanationCache();

  useEscapeKey(isOpen, onClose);

  const showExplanation = React.useCallback(
    ({ bypassCache }: { bypassCache: boolean }) => {
      const nextRequestId = () => {
        requestCountRef.current += 1;
        return requestCountRef.current;
      };
      askForExplanation(
        { getCache, setCache, explain: explainSentence, dispatch: dispatchDisplay, nextRequestId, pending: pendingExplanations },
        { fileName, sentence, surroundings, contextSize, mode },
        { bypassCache }
      );
    },
    [sentence, surroundings, fileName, contextSize, mode, getCache, setCache]
  );

  React.useEffect(() => {
    if (!isOpen || !sentence) return;
    showExplanation({ bypassCache: false });
  }, [isOpen, sentence, showExplanation]);

  // After a guest saves their API key, retry the explanation automatically. A
  // failure is never cached, so the retry asks the AI only when nothing is saved.
  React.useEffect(() => {
    if (!isOpen || !sentence) return;
    const retryExplanation = () => showExplanation({ bypassCache: false });
    window.addEventListener(GUEST_KEY_UPDATED_EVENT, retryExplanation);
    return () => window.removeEventListener(GUEST_KEY_UPDATED_EVENT, retryExplanation);
  }, [isOpen, sentence, showExplanation]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.targetTouches[0].clientX);
    setTouchEnd(e.targetTouches[0].clientX);
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentTouch = e.targetTouches[0].clientX;
    setTouchEnd(currentTouch);
    const offset = currentTouch - touchStart;
    if (offset > 0) {
      setDragOffset(offset);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    const swipeDistance = touchEnd - touchStart;
    if (swipeDistance > 100) {
      onClose();
    }
    setDragOffset(0);
  };

  React.useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      setIsDragging(false);
    }
  }, [isOpen]);

  const renderTextWithFurigana = (text: string) => (
    <span dangerouslySetInnerHTML={{ __html: segmentsToHTML(parseFurigana(text), showFurigana) }} />
  );

  const getTimeAgo = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const renderMarkdown = (text: string): string => renderSafeMarkdown(stripAiFurigana(text));

  const commitContextSize = () => {
    const settledSize = contextSizeToCommit(draftContextSize, contextSize);
    setDraftContextSize(null);
    if (settledSize !== null) setContextSize(settledSize);
  };

  const shownContextSize = draftContextSize ?? contextSize;
  const contextPercent =
    ((shownContextSize - EXPLANATION_CONFIG.MIN_CONTEXT_SIZE) /
      (EXPLANATION_CONFIG.MAX_CONTEXT_SIZE - EXPLANATION_CONFIG.MIN_CONTEXT_SIZE)) *
    100;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-all duration-300"
          style={{ backgroundColor: THEME.SCRIM_SOFT }}
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 right-0 h-full z-50 overflow-y-auto font-gothic ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          width: 'min(calc(100vw - 16px), 480px)',
          backgroundColor: THEME.SURFACE,
          color: THEME.INK,
          borderLeft: `1px solid ${THEME.INK}`,
          transform: `translateX(${isOpen ? dragOffset : '100%'}px)`,
          transition: isDragging ? 'none' : 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div
            className="w-9 h-0.5"
            style={{ backgroundColor: THEME.NEUTRAL }}
          />
        </div>

        <div className="p-4 md:p-6">
          <div
            className="flex items-start justify-between pb-4 mb-5"
            style={{ borderBottom: `1px solid ${THEME.NEUTRAL}` }}
          >
            <div className="flex-1">
              <h2 className="text-lg font-mincho font-bold" style={{ color: THEME.INK }}>
                AI Explanation
              </h2>
              {display.status === 'ready' && (
                <div className="flex items-center gap-3 mt-1">
                  {display.cachedAt !== undefined && (
                    <span className="text-xs" style={{ color: THEME.SECONDARY }}>
                      Cached {getTimeAgo(display.cachedAt)}
                    </span>
                  )}
                  <button
                    onClick={() => showExplanation({ bypassCache: true })}
                    className="text-xs font-bold cursor-pointer interactive-link"
                    style={{ color: THEME.PRIMARY }}
                  >
                    Regenerate
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center cursor-pointer interactive-link"
              style={{ color: THEME.SECONDARY }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div
            className="p-4 mb-5"
            style={{
              backgroundColor: THEME.BASE,
              border: `1px solid ${THEME.NEUTRAL}`,
            }}
          >
            <div
              className="text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: THEME.PRIMARY }}
            >
              Selected Sentence
            </div>
            <p className="font-mincho text-base leading-relaxed" style={{ color: THEME.INK, whiteSpace: 'pre-wrap' }}>
              {renderTextWithFurigana(sentence)}
            </p>
          </div>

          <div className="mb-5">
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(EXPLANATION_MODE_CONFIG).map(([modeKey, config]) => {
                const isActive = mode === modeKey;
                return (
                  <button
                    key={modeKey}
                    onClick={() => setMode(modeKey as ExplanationMode)}
                    className="px-3.5 py-1.5 text-xs font-bold cursor-pointer interactive-link"
                    style={{
                      backgroundColor: isActive ? THEME.INK : 'transparent',
                      color: isActive ? THEME.ON_INK : THEME.SECONDARY_DARK,
                      border: `1px solid ${isActive ? THEME.INK : THEME.NEUTRAL}`,
                    }}
                    title={config.description}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>

            <div>
              <button
                onClick={() => setContextSizeExpanded(!contextSizeExpanded)}
                className="text-xs font-medium flex items-center gap-1 cursor-pointer interactive-link"
                style={{ color: THEME.SECONDARY }}
              >
                Context: {shownContextSize} chars
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  style={{
                    transform: contextSizeExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 200ms',
                  }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {contextSizeExpanded && (
                <div className="mt-2">
                  <input
                    type="range"
                    min={EXPLANATION_CONFIG.MIN_CONTEXT_SIZE}
                    max={EXPLANATION_CONFIG.MAX_CONTEXT_SIZE}
                    value={shownContextSize}
                    onChange={(e) => setDraftContextSize(parseInt(e.target.value, 10))}
                    // Captured so the release still reaches the slider when the pointer has left it.
                    onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                    onPointerUp={commitContextSize}
                    onPointerCancel={commitContextSize}
                    onKeyUp={(e) => {
                      if (isSliderStepKey(e.key)) commitContextSize();
                    }}
                    onBlur={commitContextSize}
                    className="w-full"
                    style={{
                      background: `linear-gradient(to right, ${THEME.PRIMARY} 0%, ${THEME.PRIMARY} ${contextPercent}%, ${THEME.NEUTRAL} ${contextPercent}%, ${THEME.NEUTRAL} 100%)`,
                    }}
                  />
                  <div className="flex justify-between text-[10px] mt-1" style={{ color: THEME.SECONDARY }}>
                    <span>{EXPLANATION_CONFIG.MIN_CONTEXT_SIZE}</span>
                    <span>{EXPLANATION_CONFIG.MAX_CONTEXT_SIZE}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            className="p-4"
            style={{
              backgroundColor: THEME.SURFACE,
              border: `1px solid ${THEME.NEUTRAL}`,
            }}
          >
            {display.status === 'loading' && (
              <div className="flex flex-col items-center justify-center py-10">
                <div
                  className="animate-spin rounded-full h-8 w-8 border-2 border-transparent"
                  style={{ borderTopColor: THEME.PRIMARY, borderRightColor: THEME.PRIMARY }}
                />
                <span className="mt-3 text-sm" style={{ color: THEME.SECONDARY }}>
                  Generating explanation...
                </span>
              </div>
            )}

            {display.status === 'error' && (
              <div
                className="p-4"
                style={{
                  backgroundColor: toTint(THEME.DANGER, 6),
                  border: `1px solid ${THEME.DANGER}`,
                  color: THEME.DANGER,
                }}
              >
                <p className="text-sm font-bold mb-1">Error</p>
                <p className="text-sm">{display.message}</p>
              </div>
            )}

            {display.status === 'ready' && (
              <div
                className="text-sm leading-relaxed"
                style={{ color: THEME.INK }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(display.text) }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
