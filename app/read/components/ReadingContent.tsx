"use client";

import { useMemo, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { itemMainText, pageStartIndex, type ContentType, type ReaderItem as ReaderUnit } from "@/lib/content/bookModel";
import { PRIORITY_LEVELS, THEME, type PriorityScore } from "@/lib/constants";
import { toTint } from "@/lib/utils/colorTint";
import ReaderItem from "@/app/components/reading/ReaderItem";
import type { BookRef } from "@/lib/books/bookRef";
import type { SentenceLocation } from "@/lib/content/explanationContext";
import type { ImageMap } from "@/lib/types";
import type { ReadAloudState } from "@/lib/audio/readAloudPlayer";

interface ReadingContentProps {
  items: readonly ReaderUnit[];
  contentType: ContentType;
  book: BookRef;
  bookmarkIndex: number | null;
  showFurigana: boolean;
  displayMode: "collapsed" | "expanded";
  aiExplanationEnabled: boolean;
  currentPage: number;
  onBookmarkSuccess: () => void;
  onSentenceClick: (location: SentenceLocation) => void;
  imageMap: ImageMap;
  audiobookEnabled: boolean;
  startCursorIndex: number;
  playingIndex: number;
  onStartFromHere: (unitIndex: number) => void;
  priorityScores: Record<number, PriorityScore>;
  readAloud: ReadAloudState;
  onReadAloud: (unitIndex: number, text: string) => void;
  onStopReadAloud: () => void;
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
  readAloud,
  onReadAloud,
  onStopReadAloud,
}: ReadingContentProps) {
  const searchParams = useSearchParams();
  const pageStart = pageStartIndex(currentPage);
  const isRephrase = contentType === "rephrase";
  // Kept as the two former item components had them: only the rephrase layout flashes the
  // word the vocabulary list linked to, and a paragraph's sentences are clickable even with
  // AI explanations off (the click then does nothing).
  const highlightWord = isRephrase ? searchParams.get("highlight") : null;
  const areSentencesClickable = isRephrase ? aiExplanationEnabled : true;

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

  return (
    <div className={isRephrase ? "space-y-1" : "space-y-4"}>
      {paginatedItems.map((item, index) => {
        const globalIndex = pageStart + index;
        const priorityScore = priorityScores[globalIndex];

        // Always the same wrapper + key so toggling Prioritize never remounts
        // the item (which would reset its open/translation state and flash).
        return (
          <div
            key={`${currentPage}-${index}`}
            style={priorityScore !== undefined ? priorityWrapperStyle(priorityScore) : undefined}
          >
            {priorityScore !== undefined && <PriorityBadge score={priorityScore} />}
            <ReaderItem
              globalIndex={globalIndex}
              text={itemMainText(item)}
              subItems={"subItems" in item ? item.subItems : null}
              book={book}
              currentPage={currentPage}
              imageMap={imageMap}
              showFurigana={showFurigana}
              isExpanded={displayMode === "expanded"}
              areSentencesClickable={areSentencesClickable}
              highlightWord={highlightWord}
              isBookmarked={globalIndex === bookmarkIndex}
              isStartCursor={startCursorIndex === globalIndex}
              isPlaying={playingIndex === globalIndex}
              audiobookEnabled={audiobookEnabled}
              readAloudStatus={readAloud.unitIndex === globalIndex ? readAloud.status : "idle"}
              onBookmarkSaved={onBookmarkSuccess}
              onSentenceClick={onSentenceClick}
              onStartFromHere={onStartFromHere}
              onReadAloud={onReadAloud}
              onStopReadAloud={onStopReadAloud}
            />
          </div>
        );
      })}
    </div>
  );
}
