"use client";

import { useMemo, type CSSProperties } from "react";
import { pageStartIndex, type ContentType, type ReaderItem } from "@/lib/content/bookModel";
import { COLORS, PRIORITY_LEVELS, type PriorityScore } from "@/lib/constants";
import CollapsibleItem from "@/app/components/reading/CollapsibleItem";
import ParagraphItem from "@/app/components/reading/ParagraphItem";

interface ReadingContentProps {
  items: readonly ReaderItem[];
  contentType: ContentType;
  fileName: string;
  directory: string;
  bookmarkIndex: number | null;
  showFurigana: boolean;
  displayMode: "collapsed" | "expanded";
  aiExplanationEnabled: boolean;
  currentPage: number;
  isDarkMode: boolean;
  onBookmarkSuccess: () => void;
  onSentenceClick?: (sentence: string) => void;
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
    borderLeft: `${level.border}px solid ${level.color}`,
    paddingLeft: 26,
    opacity: level.opacity,
    borderRadius: 4,
    transition: "opacity 200ms ease",
  };
}

function PriorityBadge({ score }: { score: PriorityScore }) {
  const level = PRIORITY_LEVELS[score];
  return (
    <span
      title={`Importance ${score}/5 - ${level.label}`}
      style={{
        position: "absolute",
        left: 4,
        top: 4,
        width: 18,
        height: 18,
        borderRadius: "50%",
        backgroundColor: level.color,
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: 700,
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
  fileName,
  directory,
  bookmarkIndex,
  showFurigana,
  displayMode,
  aiExplanationEnabled,
  currentPage,
  isDarkMode,
  onBookmarkSuccess,
  onSentenceClick,
  imageMap,
  audiobookEnabled,
  startCursorIndex,
  playingIndex,
  onStartFromHere,
  priorityScores,
}: ReadingContentProps) {
  const fullFilePath = directory ? `${directory}/${fileName}` : fileName;
  const pageStart = pageStartIndex(currentPage);

  const paginatedItems = useMemo(
    () => items.slice(pageStart, pageStartIndex(currentPage + 1)),
    [items, pageStart, currentPage]
  );

  if (items.length === 0) {
    return (
      <div
        className="p-8 text-center font-gothic text-sm"
        style={{ border: `1px solid ${COLORS.NEUTRAL}` }}
      >
        <p style={{ color: COLORS.SECONDARY }}>No content to display</p>
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
              isDarkMode={isDarkMode}
              onSubmitSuccess={onBookmarkSuccess}
              onSentenceClick={onSentenceClick}
              imageMap={imageMap}
              bookDirectory={directory}
              bookFileName={fileName}
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
            fileName={fullFilePath}
            showFurigana={showFurigana}
            onBookmarkSuccess={onBookmarkSuccess}
            onSentenceClick={onSentenceClick}
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
