"use client";

import React, { useState } from "react";
import BookmarkUnfilled from "@/app/components/icons/BookmarkUnfilled";
import BookmarkFilled from "@/app/components/icons/BookmarkFilled";
import TranslateIcon from "@/app/components/icons/TranslateIcon";
import StartHereIcon from "@/app/components/icons/StartHereIcon";
import BookImage from "@/app/components/reading/BookImage";
import IconButton from "@/app/components/reading/IconButton";
import ParagraphText from "@/app/components/reading/ParagraphText";
import { COLORS, THEME } from "@/lib/constants";
import { hasIllustration, splitUnitParts } from "@/lib/content/unitParts";
import { toTint } from "@/lib/utils/colorTint";
import { bookImagePath } from "@/lib/utils/bookAssetPath";
import { toBookKey, type BookRef } from "@/lib/books/bookRef";
import { saveBookmark, translate } from "@/lib/api/client";

interface ParagraphItemProps {
  id?: string;
  globalIndex?: number;
  text: string;
  isBookmarked: boolean;
  book: BookRef;
  showFurigana: boolean;
  onBookmarkSuccess: () => void;
  onSentenceClick?: (sentence: string, occurrence: number) => void;
  imageMap?: Record<string, string>;
  currentPage?: number;
  audiobookEnabled?: boolean;
  isStartCursor?: boolean;
  isPlaying?: boolean;
  onStartFromHere?: (unitIndex: number) => void;
}

const ParagraphItem: React.FC<ParagraphItemProps> = ({
  id,
  globalIndex,
  text,
  isBookmarked,
  book,
  showFurigana,
  onBookmarkSuccess,
  onSentenceClick,
  imageMap,
  currentPage,
  audiobookEnabled,
  isStartCursor,
  isPlaying,
  onStartFromHere,
}) => {
  const [loading, setLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [unavailableImagePaths, setUnavailableImagePaths] = useState<ReadonlySet<string>>(() => new Set());

  const handleBookmarkClick = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await saveBookmark({ ...book, content: text, page: currentPage });
      onBookmarkSuccess();
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
      const { translatedText } = await translate(text);
      setTranslatedText(translatedText);
      setShowTranslation(true);
    } catch (error) {
      console.error("Translation error:", error);
    } finally {
      setTranslating(false);
    }
  };

  const paragraphParts = splitUnitParts(text);
  const hasImage = hasIllustration(paragraphParts);

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

  const renderContentWithImages = () => {
    if (showTranslation && translatedText) {
      return (
        <div
          className="head-text font-bold text-lg whitespace-pre-wrap"
          style={{ color: THEME.SECONDARY_DARK }}
        >
          {translatedText}
        </div>
      );
    }

    if (!hasImage) {
      return (
        <div
          className="head-text font-bold text-lg whitespace-pre-wrap"
          onClickCapture={handleTripleClickSelect}
        >
          {paragraphParts.map(
            (part, index) =>
              part.kind === "text" && (
                <ParagraphText
                  key={index}
                  text={part.text}
                  sentences={part.sentences}
                  showFurigana={showFurigana}
                  onSentenceClick={onSentenceClick}
                />
              )
          )}
        </div>
      );
    }

    return (
      <div className="paragraph-content">
        {paragraphParts.map((part, index) => {
          if (part.kind === "text") {
            return (
              <div
                key={index}
                className="head-text font-bold text-lg whitespace-pre-wrap"
                onClickCapture={handleTripleClickSelect}
              >
                <ParagraphText
                  text={part.text}
                  sentences={part.sentences}
                  showFurigana={showFurigana}
                  onSentenceClick={onSentenceClick}
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
                altText={`Illustration from ${toBookKey(book)}`}
                onUnavailable={() => markImageUnavailable(imagePath)}
              />
            );
          }
        })}
      </div>
    );
  };

  // A paragraph made only of illustrations, none of which exist, would be an empty card.
  const isOnlyUnavailableImages =
    paragraphParts.length > 0 &&
    paragraphParts.every(
      (part) => part.kind === "image" && unavailableImagePaths.has(resolveImage(part.name).imagePath)
    );
  if (isOnlyUnavailableImages) {
    return null;
  }

  return (
    <div className="paragraph-item" id={id} data-global-index={globalIndex} style={{ scrollMarginTop: '80px' }}>
      <div
        className="p-4 my-4"
        style={{
          backgroundColor: isPlaying
            ? toTint(COLORS.PLAYING, 10)
            : isStartCursor
              ? toTint(COLORS.START_CURSOR, 7)
              : isBookmarked
                ? toTint(THEME.PRIMARY, 7)
                : "transparent",
          borderLeft: isPlaying
            ? `2px solid ${COLORS.PLAYING}`
            : isStartCursor
              ? `2px solid ${COLORS.START_CURSOR}`
              : isBookmarked
                ? `2px solid ${THEME.PRIMARY}`
                : "none",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex-1 min-w-0">{renderContentWithImages()}</div>
          <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5 self-end sm:self-auto">
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
        <IconButton
          disabled={translating}
          onClick={handleTranslateClick}
          style={{ opacity: translating ? 0.5 : 1 }}
          aria-label="Translate"
        >
          <TranslateIcon isActive={showTranslation} />
        </IconButton>
        <form
          onSubmit={handleBookmarkClick}
          onClick={(e) => e.stopPropagation()}
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
      </div>
    </div>
  );
};

export default ParagraphItem;
