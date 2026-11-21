"use client";

import React, { useEffect, useState } from "react";
import BookmarkUnfilled from "@/app/components/icons/BookmarkUnfilled";
import BookmarkFilled from "@/app/components/icons/BookmarkFilled";
import TranslateIcon from "@/app/components/icons/TranslateIcon";
import StartHereIcon from "@/app/components/icons/StartHereIcon";
import BookImage from "@/app/components/reading/BookImage";
import IconButton from "@/app/components/reading/IconButton";
import ParagraphText from "@/app/components/reading/ParagraphText";
import TTSButton from "@/app/components/reading/TTSButton";
import { useSearchParams } from "next/navigation";
import { COLORS, THEME } from "@/lib/constants";
import { hasIllustration, splitUnitParts } from "@/lib/content/unitParts";
import { toTint } from "@/lib/utils/colorTint";
import { bookImagePath } from "@/lib/utils/bookAssetPath";
import type { BookRef } from "@/lib/books/bookRef";
import { saveBookmark, translate } from "@/lib/api/client";

interface CollapsibleItemProps {
  id?: string;
  globalIndex?: number;
  head: string;
  subItems: string[];
  initialDropdownState?: boolean;
  onSubmitSuccess: () => void;
  showFurigana?: boolean;
  aiExplanationEnabled?: boolean;
  onSentenceClick?: (sentence: string, occurrence: number) => void;
  imageMap?: Record<string, string>;
  book: BookRef;
  currentPage?: number;
  audiobookEnabled?: boolean;
  isStartCursor?: boolean;
  isPlaying?: boolean;
  onStartFromHere?: (unitIndex: number) => void;
  onStartContinuousPlay?: () => void;
}

const CollapsibleItem: React.FC<CollapsibleItemProps> = ({
  id,
  globalIndex,
  head,
  subItems,
  initialDropdownState = false,
  onSubmitSuccess,
  showFurigana = false,
  aiExplanationEnabled = true,
  onSentenceClick,
  imageMap,
  book,
  currentPage,
  audiobookEnabled,
  isStartCursor,
  isPlaying,
  onStartFromHere,
  onStartContinuousPlay,
}) => {
  const searchParams = useSearchParams();
  const highlightWord = searchParams.get("highlight");

  const [isOpen, setIsOpen] = useState(initialDropdownState);
  const [loading, setLoading] = useState(false);
  const [shouldHighlight, setShouldHighlight] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [unavailableImagePaths, setUnavailableImagePaths] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (highlightWord && head.includes(highlightWord)) {
      setShouldHighlight(true);
      const timer = setTimeout(() => {
        setShouldHighlight(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightWord, head]);

  const toggleOpen = () => {
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    setIsOpen(initialDropdownState);
  }, [initialDropdownState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await saveBookmark({ ...book, content: head, page: currentPage });
      onSubmitSuccess();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleTranslateClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (showTranslation) {
      setShowTranslation(false);
      return;
    }

    if (translatedText) {
      setShowTranslation(true);
      return;
    }

    try {
      setTranslating(true);
      const { translatedText } = await translate(head);
      setTranslatedText(translatedText);
      setShowTranslation(true);
    } catch (error) {
      console.error("Translation error:", error);
    } finally {
      setTranslating(false);
    }
  };

  const handleTripleClickSelect = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail >= 3) {
      e.stopPropagation();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(e.currentTarget);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  const headParts = splitUnitParts(head);
  const hasImage = hasIllustration(headParts);
  const headSentenceClick = aiExplanationEnabled ? onSentenceClick : undefined;

  const resolveImage = (originalName: string) => {
    const actualFileName =
      imageMap?.[originalName] ||
      imageMap?.[`image/${originalName}`] ||
      originalName;
    const imagePath = bookImagePath(book.directory, book.fileName, actualFileName);
    return { actualFileName, imagePath };
  };

  const markImageUnavailable = (imagePath: string) =>
    setUnavailableImagePaths((previous) => new Set(previous).add(imagePath));

  const renderHeadWithImages = () => {
    if (showTranslation && translatedText) {
      return (
        <span style={{ color: THEME.SECONDARY_DARK }}>
          {translatedText}
        </span>
      );
    }

    if (!hasImage) {
      return headParts.map(
        (part, index) =>
          part.kind === "text" && (
            <ParagraphText
              key={index}
              text={part.text}
              sentences={part.sentences}
              showFurigana={showFurigana}
              onSentenceClick={headSentenceClick}
            />
          )
      );
    }

    return (
      <div className="head-content">
        {headParts.map((part, index) => {
          if (part.kind === "text") {
            return (
              <div key={index} className="whitespace-pre-wrap">
                <ParagraphText
                  text={part.text}
                  sentences={part.sentences}
                  showFurigana={showFurigana}
                  onSentenceClick={headSentenceClick}
                />
              </div>
            );
          } else {
            const { actualFileName, imagePath } = resolveImage(part.name);
            return (
              <BookImage
                key={index}
                fileName={actualFileName}
                imagePath={imagePath}
                altText={`Illustration from ${book.fileName}`}
                onUnavailable={() => markImageUnavailable(imagePath)}
              />
            );
          }
        })}
      </div>
    );
  };

  const isBookmarked = id === "bookmark";

  const containerStyle: React.CSSProperties = isPlaying
    ? {
        borderLeft: `2px solid ${COLORS.PLAYING}`,
        backgroundColor: toTint(COLORS.PLAYING, 10),
      }
    : shouldHighlight
    ? {
        backgroundColor: toTint(THEME.PRIMARY, 10),
        borderLeft: "none",
        transition: "background-color 3s ease, border-left 3s ease",
      }
    : isStartCursor
      ? {
          borderLeft: `2px solid ${COLORS.START_CURSOR}`,
          backgroundColor: toTint(COLORS.START_CURSOR, 7),
        }
      : isBookmarked
        ? {
            borderLeft: `2px solid ${THEME.PRIMARY}`,
            backgroundColor: toTint(THEME.PRIMARY, 7),
          }
        : {};

  // A line whose original is only illustrations, none of which exist, would be an empty card.
  const isOnlyUnavailableImages =
    headParts.length > 0 &&
    headParts.every(
      (part) => part.kind === "image" && unavailableImagePaths.has(resolveImage(part.name).imagePath)
    );
  if (isOnlyUnavailableImages) {
    return null;
  }

  return (
    <div className="collapsibleItem" id={id} data-global-index={globalIndex} style={{ scrollMarginTop: '80px' }}>
      <div
        className="p-4 my-4"
        style={{
          transition: "background-color 3s ease, border-left 0.2s ease",
          ...containerStyle,
        }}
        id="collapsible-item"
      >
        <div
          className="head-text font-bold text-lg whitespace-pre-wrap"
          onClickCapture={handleTripleClickSelect}
          style={{
            color: THEME.INK,
            ...(!aiExplanationEnabled
              ? { userSelect: "text" as const, cursor: "text" }
              : {}),
          }}
        >
          {renderHeadWithImages()}
        </div>
        <div className="mt-1.5 flex items-center gap-2 h-9">
          {subItems.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleOpen();
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
          )}
          <span aria-hidden="true" className="flex-1 h-px" style={{ backgroundColor: THEME.NEUTRAL }} />
          <div className="flex items-center gap-0.5 flex-shrink-0 -mr-1.5">
            {audiobookEnabled && onStartFromHere && globalIndex != null && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  onStartFromHere(globalIndex);
                }}
                aria-label="Set audio start here"
                title="Start audio from here"
              >
                <StartHereIcon isActive={isStartCursor} />
              </IconButton>
            )}
            <TTSButton text={head} onLongPress={onStartContinuousPlay} />
            <IconButton
              disabled={translating}
              onClick={handleTranslateClick}
              style={{ opacity: translating ? 0.5 : 1 }}
              aria-label="Translate"
            >
              <TranslateIcon isActive={showTranslation} />
            </IconButton>
            <form
              onSubmit={handleSubmit}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex"
            >
              <IconButton
                disabled={loading}
                type="submit"
                aria-label="Bookmark"
              >
                {isBookmarked ? <BookmarkFilled /> : <BookmarkUnfilled />}
              </IconButton>
            </form>
          </div>
        </div>
        {isOpen && (
          <div
            className="mt-1 px-3 py-2.5 flex flex-col gap-2"
            style={{ backgroundColor: THEME.SURFACE_MUTED }}
          >
            {subItems.map((subItem, index) => (
              <div
                key={index}
                className="sub-item-text"
                onClick={handleTripleClickSelect}
                style={{ color: THEME.SECONDARY_DARK }}
              >
                {index === 4 ? "" : <ParagraphText text={subItem} showFurigana={showFurigana} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollapsibleItem;
