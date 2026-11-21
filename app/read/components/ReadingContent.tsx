"use client";

import { useMemo, type CSSProperties } from "react";
import { pageStartIndex, type ContentType, type ReaderItem } from "@/lib/content/bookModel";
import { PRIORITY_LEVELS, THEME, type PriorityScore } from "@/lib/constants";
import { toTint } from "@/lib/utils/colorTint";
import CollapsibleItem from "@/app/components/reading/CollapsibleItem";
import ParagraphItem from "@/app/components/reading/ParagraphItem";
import type { BookRef } from "@/lib/books/bookRef";
import type { SentenceLocation } from "@/lib/content/explanationContext";

interface ReadingContentProps {
  items: readonly ReaderItem[];
  contentType: ContentType;
  book: BookRef;
  bookmarkIndex: number | null;
  showFurigana: boolean;
  displayMode: "collapsed" | "expanded";
  aiExplanationEnabled: boolean;
  currentPage: number;
  onBookmarkSuccess: () => void;
  onSentenceClick?: (location: SentenceLocation) => void;
  imageMap?: Record<string, string>;
  audiobookEnabled?: boolean;
  startCursorIndex?: number;
  playingIndex?: number;
  onStartFromHere?: (unitIndex: number) => void;
  priorityScores?: Record<number, PriorityScore>;
}

function priorityWrapperStyle(score: PriorityScore): CSSProperties {
  const level = PRIORITY_LEVELS[score];
  return {
    position: "relative",
    borderLeft: `${level.ruleWidthPx}px solid ${toTint(THEME.PRIMARY, level.ruleTintPercent)}`,
    paddingLeft: 26,
    opacity: level.opacity,
    transition: "opacity 200ms ease",
  };
}

function PriorityBadge({ score }: { score: PriorityScore }) {
  const level = PRIORITY_LEVELS[score];
  return (
    <span
      className="font-gothic"
      title={`重要度 ${score}/5・${level.label}`}
      style={{
        position: "absolute",
        left: 4,
        top: 4,
        width: 16,
        height: 16,
        border: `1px solid ${THEME.NEUTRAL}`,
        color: THEME.SECONDARY,
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
    >
      {score}
    </span>
  );
}

export default function ReadingContent({
  items,
  contentType,
  book,
  bookmarkIndex,
  showFurigana,
  displayMode,
  aiExplanationEnabled,
  currentPage,
  onBookmarkSuccess,
  onSentenceClick,
  imageMap,
  audiobookEnabled,
  startCursorIndex,
  playingIndex,
  onStartFromHere,
  priorityScores,
}: ReadingContentProps) {
  const pageStart = pageStartIndex(currentPage);

  const sentenceClickFor = (unitIndex: number) =>
    onSentenceClick
      ? (sentence: string, occurrence: number) => onSentenceClick({ unitIndex, sentence, occurrence })
      : undefined;

  const paginatedItems = useMemo(
    () => items.slice(pageStart, pageStartIndex(currentPage + 1)),
    [items, pageStart, currentPage]
  );

  if (items.length === 0) {
    return (
      <div
        className="p-8 text-center font-gothic text-sm"
        style={{ border: `1px solid ${THEME.NEUTRAL}` }}
      >
        <p style={{ color: THEME.SECONDARY }}>No content to display</p>
      </div>
    );
  }

  if (contentType === "rephrase") {
    return (
      <div className="space-y-1">
        {paginatedItems.map((item, index) => {
          const typedItem = item as { head: string; subItems: string[] };
          const globalIndex = pageStart + index;
          const isBookmarked = globalIndex === bookmarkIndex;
          const priorityScore = priorityScores?.[globalIndex];

          const itemEl = (
            <CollapsibleItem
              key={`${currentPage}-${index}`}
              {...(isBookmarked ? { id: "bookmark" } : {})}
              globalIndex={globalIndex}
              head={typedItem.head}
              subItems={typedItem.subItems}
              initialDropdownState={displayMode === "expanded"}
              showFurigana={showFurigana}
              aiExplanationEnabled={aiExplanationEnabled}
              onSubmitSuccess={onBookmarkSuccess}
              onSentenceClick={sentenceClickFor(globalIndex)}
              imageMap={imageMap}
              book={book}
              currentPage={currentPage}
              audiobookEnabled={audiobookEnabled}
              isStartCursor={startCursorIndex === globalIndex}
              isPlaying={playingIndex === globalIndex}
              onStartFromHere={onStartFromHere}
            />
          );

          // Always the same wrapper + key so toggling Prioritize never remounts
          // the item (which would reset its open/translation state and flash).
          return (
            <div
              key={`${currentPage}-${index}`}
              style={priorityScore !== undefined ? priorityWrapperStyle(priorityScore) : undefined}
            >
              {priorityScore !== undefined && <PriorityBadge score={priorityScore} />}
              {itemEl}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {paginatedItems.map((item, index) => {
        const typedItem = item as { text: string };
        const globalIndex = pageStart + index;
        const isBookmarked = globalIndex === bookmarkIndex;
        const priorityScore = priorityScores?.[globalIndex];

        const itemEl = (
          <ParagraphItem
            key={`${currentPage}-${index}`}
            {...(isBookmarked ? { id: "bookmark" } : {})}
            globalIndex={globalIndex}
            text={typedItem.text}
            isBookmarked={isBookmarked}
            book={book}
            showFurigana={showFurigana}
            onBookmarkSuccess={onBookmarkSuccess}
            onSentenceClick={sentenceClickFor(globalIndex)}
            imageMap={imageMap}
            currentPage={currentPage}
            audiobookEnabled={audiobookEnabled}
            isStartCursor={startCursorIndex === globalIndex}
            isPlaying={playingIndex === globalIndex}
            onStartFromHere={onStartFromHere}
          />
        );

        // Always the same wrapper + key so toggling Prioritize never remounts
        // the item (which would reset its open/translation state and flash).
        return (
          <div
            key={`${currentPage}-${index}`}
            style={priorityScore !== undefined ? priorityWrapperStyle(priorityScore) : undefined}
          >
            {priorityScore !== undefined && <PriorityBadge score={priorityScore} />}
            {itemEl}
          </div>
        );
      })}
    </div>
  );
}
