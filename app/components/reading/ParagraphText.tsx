"use client";

import { memo, useMemo, type CSSProperties, type MouseEvent } from "react";
import { THEME } from "@/lib/constants";
import type { UnitSentence } from "@/lib/content/unitParts";
import { parseFurigana, segmentsToHTML } from "@/lib/utils/furiganaParser";
import { toTint } from "@/lib/utils/colorTint";

interface ParagraphTextProps {
  text: string;
  showFurigana: boolean;
  /** The text's sentences; with onSentenceClick each one becomes its own clickable span. */
  sentences?: readonly UnitSentence[];
  onSentenceClick?: (sentence: string, occurrence: number) => void;
}

const SENTENCE_STYLE: CSSProperties = {
  backgroundColor: "transparent",
  transition: "background-color 0.2s ease",
};

function furiganaHtml(text: string, showFurigana: boolean): string {
  return segmentsToHTML(parseFurigana(text), showFurigana);
}

function tintSentence(e: MouseEvent<HTMLSpanElement>) {
  e.currentTarget.style.backgroundColor = toTint(THEME.PRIMARY, 10);
}

function clearSentenceTint(e: MouseEvent<HTMLSpanElement>) {
  e.currentTarget.style.backgroundColor = "transparent";
}

// A drag or double click that selected text inside a sentence also ends in a click on it.
function endsTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/** Book text with its furigana, either as one span or as one clickable span per sentence. */
function ParagraphText({ text, showFurigana, sentences, onSentenceClick }: ParagraphTextProps) {
  const clickableSentences = onSentenceClick ? sentences : undefined;
  const htmlPieces = useMemo(
    () =>
      clickableSentences
        ? clickableSentences.map((sentence) => furiganaHtml(sentence.text, showFurigana))
        : [furiganaHtml(text, showFurigana)],
    [clickableSentences, text, showFurigana]
  );

  if (!clickableSentences || !onSentenceClick) {
    return <span dangerouslySetInnerHTML={{ __html: htmlPieces[0] }} />;
  }

  return (
    <>
      {clickableSentences.map((sentence, index) => (
        <span
          key={index}
          dangerouslySetInnerHTML={{ __html: htmlPieces[index] }}
          onClick={(e) => {
            e.stopPropagation();
            if (endsTextSelection()) return;
            onSentenceClick(sentence.text, sentence.occurrence);
          }}
          className="cursor-pointer transition-colors px-1"
          style={SENTENCE_STYLE}
          onMouseEnter={tintSentence}
          onMouseLeave={clearSentenceTint}
        />
      ))}
    </>
  );
}

export default memo(ParagraphText);
