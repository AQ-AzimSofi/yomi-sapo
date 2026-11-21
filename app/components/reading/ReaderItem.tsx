"use client";

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import BookmarkUnfilled from "@/app/components/icons/BookmarkUnfilled";
import BookmarkFilled from "@/app/components/icons/BookmarkFilled";
import TranslateIcon from "@/app/components/icons/TranslateIcon";
import StartHereIcon from "@/app/components/icons/StartHereIcon";
import BookImage from "@/app/components/reading/BookImage";
import IconButton from "@/app/components/reading/IconButton";
import ParagraphText from "@/app/components/reading/ParagraphText";
import TTSButton from "@/app/components/reading/TTSButton";
import { useItemActions } from "@/app/hooks/useItemActions";
import { COLORS, THEME } from "@/lib/constants";
import { hasIllustration, splitUnitParts, type UnitPart } from "@/lib/content/unitParts";
import type { SentenceLocation } from "@/lib/content/explanationContext";
import type { ReadAloudStatus } from "@/lib/audio/readAloudPlayer";
import { toTint } from "@/lib/utils/colorTint";
import { bookImagePath } from "@/lib/utils/bookAssetPath";
import { toBookKey, type BookRef } from "@/lib/books/bookRef";
import type { ImageMap } from "@/lib/types";

const HIGHLIGHT_MS = 3000;
const REPHRASE_CARD_TRANSITION = "background-color 3s ease, border-left 0.2s ease";
const SELECTABLE_TEXT_STYLE: CSSProperties = { userSelect: "text", cursor: "text" };
// The simpler versions show every line but the fifth, as they always have.
const HIDDEN_SUB_ITEM_INDEX = 4;

interface ReaderItemProps {
  globalIndex: number;
  text: string;
  /** A rephrase unit's simpler versions, shown under its やさしく toggle; null lays the unit out as a paragraph. */
  subItems: readonly string[] | null;
  book: BookRef;
  currentPage: number;
  imageMap: ImageMap;
  showFurigana: boolean;
  isExpanded: boolean;
  /** Each sentence is its own span that asks for an explanation when clicked. */
  areSentencesClickable: boolean;
  /** A word to flash the item for when its text holds it. */
  highlightWord: string | null;
  isBookmarked: boolean;
  isStartCursor: boolean;
  isPlaying: boolean;
  audiobookEnabled: boolean;
  /** Where the reader's read-aloud player is with this item. */
  readAloudStatus: ReadAloudStatus;
  onBookmarkSaved: () => void;
  onSentenceClick: (location: SentenceLocation) => void;
  onStartFromHere: (unitIndex: number) => void;
  onReadAloud: (unitIndex: number, text: string) => void;
  onStopReadAloud: () => void;
}

interface CardState {
  isPlaying: boolean;
  isHighlighted: boolean;
  isStartCursor: boolean;
  isBookmarked: boolean;
}

function cardStyle({ isPlaying, isHighlighted, isStartCursor, isBookmarked }: CardState): CSSProperties {
  if (isPlaying) return { borderLeft: `2px solid ${COLORS.PLAYING}`, backgroundColor: toTint(COLORS.PLAYING, 10) };
  if (isHighlighted) {
    return {
      backgroundColor: toTint(THEME.PRIMARY, 10),
      borderLeft: "none",
      transition: "background-color 3s ease, border-left 3s ease",
    };
  }
  if (isStartCursor) return { borderLeft: `2px solid ${COLORS.START_CURSOR}`, backgroundColor: toTint(COLORS.START_CURSOR, 7) };
  if (isBookmarked) return { borderLeft: `2px solid ${THEME.PRIMARY}`, backgroundColor: toTint(THEME.PRIMARY, 7) };
  return {};
}

function useHighlight(text: string, highlightWord: string | null): boolean {
  const [isHighlighted, setIsHighlighted] = useState(false);
  useEffect(() => {
    if (!highlightWord || !text.includes(highlightWord)) return;
    setIsHighlighted(true);
    const timer = setTimeout(() => setIsHighlighted(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightWord, text]);
  return isHighlighted;
}

function SimplerVersionsToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={isOpen}
      className="interactive-link cursor-pointer h-9 flex items-center gap-1 font-gothic text-[11px] font-bold tracking-[0.14em]"
      style={{ color: THEME.PRIMARY, background: "none", border: "none", padding: 0 }}
    >
      やさしく
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 640 640"
        width="12"
        height="12"
        aria-hidden="true"
        style={{
          fill: THEME.PRIMARY,
          transition: "transform 200ms ease",
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
        }}
      >
        <path d="M297.4 470.6C309.9 483.1 330.2 483.1 342.7 470.6L534.7 278.6C547.2 266.1 547.2 245.8 534.7 233.3C522.2 220.8 501.9 220.8 489.4 233.3L320 402.7L150.6 233.4C138.1 220.9 117.8 220.9 105.3 233.4C92.8 245.9 92.8 266.2 105.3 278.7L297.3 470.7z" />
      </svg>
    </button>
  );
}

function ReaderItem({
  globalIndex,
  text,
  subItems,
  book,
  currentPage,
  imageMap,
  showFurigana,
  isExpanded,
  areSentencesClickable,
  highlightWord,
  isBookmarked,
  isStartCursor,
  isPlaying,
  audiobookEnabled,
  readAloudStatus,
  onBookmarkSaved,
  onSentenceClick,
  onStartFromHere,
  onReadAloud,
  onStopReadAloud,
}: ReaderItemProps) {
  const [isOpen, setIsOpen] = useState(isExpanded);
  const [unavailableImagePaths, setUnavailableImagePaths] = useState<ReadonlySet<string>>(() => new Set());
  const isHighlighted = useHighlight(text, highlightWord);
  const parts = useMemo(() => splitUnitParts(text), [text]);
  const {
    isSavingBookmark,
    bookmarkItem,
    isTranslationShown,
    translatedText,
    isTranslating,
    toggleTranslation,
    selectOnTripleClick,
  } = useItemActions({ text, book, currentPage, onBookmarkSaved });

  useEffect(() => {
    setIsOpen(isExpanded);
  }, [isExpanded]);

  const explainSentence = useCallback(
    (sentence: string, occurrence: number) => onSentenceClick({ unitIndex: globalIndex, sentence, occurrence }),
    [onSentenceClick, globalIndex]
  );
  const sentenceClick = areSentencesClickable ? explainSentence : undefined;

  const resolveImage = (originalName: string) => {
    const actualFileName = imageMap[originalName] || imageMap[`image/${originalName}`] || originalName;
    return { actualFileName, imagePath: bookImagePath(book.directory, book.fileName, actualFileName) };
  };

  // A unit made only of illustrations, none of which exist, would be an empty card.
  const isOnlyUnavailableImages =
    parts.length > 0 &&
    parts.every((part) => part.kind === "image" && unavailableImagePaths.has(resolveImage(part.name).imagePath));
  if (isOnlyUnavailableImages) {
    return null;
  }

  const renderTextRun = (part: Extract<UnitPart, { kind: "text" }>, key: number) => (
    <ParagraphText
      key={key}
      text={part.text}
      sentences={part.sentences}
      showFurigana={showFurigana}
      onSentenceClick={sentenceClick}
    />
  );

  const renderImage = (name: string, key: number) => {
    const { actualFileName, imagePath } = resolveImage(name);
    return (
      <BookImage
        key={key}
        fileName={actualFileName}
        imagePath={imagePath}
        altText={`Illustration from ${toBookKey(book)}`}
        onUnavailable={() => setUnavailableImagePaths((previous) => new Set(previous).add(imagePath))}
      />
    );
  };

  const renderMainText = (): ReactNode => {
    if (isTranslationShown && translatedText) {
      return <span style={{ color: THEME.SECONDARY_DARK }}>{translatedText}</span>;
    }
    if (!hasIllustration(parts)) {
      return parts.map((part, index) => part.kind === "text" && renderTextRun(part, index));
    }
    return (
      <div className="head-content">
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <div key={index} className="whitespace-pre-wrap">
              {renderTextRun(part, index)}
            </div>
          ) : (
            renderImage(part.name, index)
          )
        )}
      </div>
    );
  };

  const mainText = (
    <div
      className="head-text whitespace-pre-wrap"
      onClickCapture={selectOnTripleClick}
      style={{ color: THEME.INK, ...(areSentencesClickable ? {} : SELECTABLE_TEXT_STYLE) }}
    >
      {renderMainText()}
    </div>
  );

  const actionButtons = (
    <>
      {audiobookEnabled && (
        <IconButton
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            onStartFromHere(globalIndex);
          }}
          aria-label="Set audio start here"
          title="Start audio from here"
        >
          <StartHereIcon isActive={isStartCursor} />
        </IconButton>
      )}
      {subItems && (
        <TTSButton status={readAloudStatus} onToggle={() => onReadAloud(globalIndex, text)} onStop={onStopReadAloud} />
      )}
      <IconButton
        disabled={isTranslating}
        onClick={toggleTranslation}
        style={{ opacity: isTranslating ? 0.5 : 1 }}
        aria-label="Translate"
      >
        <TranslateIcon isActive={isTranslationShown} />
      </IconButton>
      <form onSubmit={bookmarkItem} onClick={(e) => e.stopPropagation()} className="inline-flex">
        <IconButton disabled={isSavingBookmark} type="submit" aria-label="Bookmark">
          {isBookmarked ? <BookmarkFilled /> : <BookmarkUnfilled />}
        </IconButton>
      </form>
    </>
  );

  const card = cardStyle({ isPlaying, isHighlighted, isStartCursor, isBookmarked });

  return (
    <div
      className="reader-item"
      id={isBookmarked ? "bookmark" : undefined}
      data-global-index={globalIndex}
      style={{ scrollMarginTop: "80px" }}
    >
      {subItems ? (
        <div className="p-4 my-4" style={{ transition: REPHRASE_CARD_TRANSITION, ...card }}>
          {mainText}
          <div className="mt-1.5 flex items-center gap-2 h-9">
            {subItems.length > 0 && <SimplerVersionsToggle isOpen={isOpen} onToggle={() => setIsOpen(!isOpen)} />}
            <span aria-hidden="true" className="flex-1 h-px" style={{ backgroundColor: THEME.NEUTRAL }} />
            <div className="flex items-center gap-0.5 flex-shrink-0 -mr-1.5">{actionButtons}</div>
          </div>
          {isOpen && (
            <div className="mt-1 px-3 py-2.5 flex flex-col gap-2" style={{ backgroundColor: THEME.SURFACE_MUTED }}>
              {subItems.map((subItem, index) => (
                <div
                  key={index}
                  className="sub-item-text"
                  onClick={selectOnTripleClick}
                  style={{ color: THEME.SECONDARY_DARK }}
                >
                  {index === HIDDEN_SUB_ITEM_INDEX ? "" : <ParagraphText text={subItem} showFurigana={showFurigana} />}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 my-4" style={card}>
          <div className="flex flex-col sm:flex-row sm:items-start gap-2">
            <div className="flex-1 min-w-0">{mainText}</div>
            <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5 self-end sm:self-auto">{actionButtons}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Every prop is a value or a reference the reader keeps stable, so an item re-renders only
// when something it shows changes, not on every reader update (an audiobook step, a panel).
export default memo(ReaderItem);
