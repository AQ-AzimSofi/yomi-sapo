"use client";

import React, { useEffect, useState } from "react";
import BookmarkUnfilled from "@/app/components/icons/BookmarkUnfilled";
import BookmarkFilled from "@/app/components/icons/BookmarkFilled";
import TranslateIcon from "@/app/components/icons/TranslateIcon";
import StartHereIcon from "@/app/components/icons/StartHereIcon";
import BookImage from "@/app/components/reading/BookImage";
import TTSButton from "@/app/components/reading/TTSButton";
import { useSearchParams } from "next/navigation";
import { COLORS, EXPLANATION_CONFIG, DARK_COLORS, READER_THEME } from "@/lib/constants";
import { parseFurigana, segmentsToHTML } from "@/lib/utils/furiganaParser";
import { toTint } from "@/lib/utils/colorTint";
import { bookImagePath } from "@/lib/utils/bookAssetPath";
import { guestKeyHeaders, promptGuestKeyOnFailure } from "@/lib/guestKeys";

const IMAGE_PATTERN = /\[IMAGE:([^\]]+)\]/;

interface CollapsibleItemProps {
  id?: string;
  globalIndex?: number;
  head: string;
  subItems: string[];
  initialDropdownState?: boolean;
  onSubmitSuccess: () => void;
  showFurigana?: boolean;
  aiExplanationEnabled?: boolean;
  isDarkMode?: boolean;
  onSentenceClick?: (sentence: string) => void;
  imageMap?: Record<string, string>;
  bookDirectory?: string;
  bookFileName?: string;
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
  isDarkMode = false,
  onSentenceClick,
  imageMap,
  bookDirectory,
  bookFileName,
  currentPage,
  audiobookEnabled,
  isStartCursor,
  isPlaying,
  onStartFromHere,
  onStartContinuousPlay,
}) => {
  const searchParams = useSearchParams();
  const directoryParam = searchParams.get("directory");
  const fileNameParam = searchParams.get("fileName");
  const highlightWord = searchParams.get("highlight");

  const fileName: string =
    (directoryParam && fileNameParam
      ? `${directoryParam}/${fileNameParam}`
      : fileNameParam) || "text-1";

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

  const accentColor = isDarkMode ? DARK_COLORS.PRIMARY : COLORS.PRIMARY;
  const mutedTextColor = isDarkMode ? DARK_COLORS.TEXT_MUTED : COLORS.SECONDARY_DARK;
  const ruleColor = isDarkMode ? DARK_COLORS.NEUTRAL : COLORS.NEUTRAL;
  const glossBackground = isDarkMode ? DARK_COLORS.SURFACE : READER_THEME.SURFACE_MUTED;

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
      const response = await fetch("/api/write-bookmark", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: fileName, content: head, page: currentPage }),
      });
      if (!response.ok) {
        throw new Error("Failed");
      }
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
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...guestKeyHeaders("translate"),
        },
        body: JSON.stringify({ text: head }),
      });

      if (!response.ok) {
        await promptGuestKeyOnFailure("translate", response);
        throw new Error("Translation failed");
      }

      const data = await response.json();
      setTranslatedText(data.translatedText);
      setShowTranslation(true);
    } catch (error) {
      console.error("Translation error:", error);
    } finally {
      setTranslating(false);
    }
  };

  const splitIntoSentences = (text: string): string[] => {
    const delimiters: readonly string[] = EXPLANATION_CONFIG.SENTENCE_DELIMITERS;
    const sentences: string[] = [];
    let currentSentence = "";

    for (let i = 0; i < text.length; i++) {
      currentSentence += text[i];

      if (delimiters.includes(text[i])) {
        sentences.push(currentSentence.trim());
        currentSentence = "";
      }
    }

    if (currentSentence.trim()) {
      sentences.push(currentSentence.trim());
    }

    return sentences.filter((s) => s.length > 0);
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

  const renderTextWithFurigana = (
    text: string,
    isClickable: boolean = false
  ) => {
    if (!isClickable || !aiExplanationEnabled) {
      const segments = parseFurigana(text);
      const html = segmentsToHTML(segments, showFurigana);
      return <span dangerouslySetInnerHTML={{ __html: html }} />;
    }

    const sentences = splitIntoSentences(text);

    return (
      <>
        {sentences.map((sentence, index) => {
          const segments = parseFurigana(sentence);
          const html = segmentsToHTML(segments, showFurigana);

          return (
            <span
              key={index}
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={(e) => {
                e.stopPropagation();
                onSentenceClick?.(sentence);
              }}
              className={
                onSentenceClick
                  ? "cursor-pointer transition-colors px-1"
                  : ""
              }
              style={
                onSentenceClick
                  ? {
                      backgroundColor: "transparent",
                      transition: "background-color 0.2s ease",
                    }
                  : {}
              }
              onMouseEnter={(e) => {
                if (onSentenceClick) {
                  e.currentTarget.style.backgroundColor = toTint(accentColor, 10);
                }
              }}
              onMouseLeave={(e) => {
                if (onSentenceClick) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            />
          );
        })}
      </>
    );
  };

  const hasImage = IMAGE_PATTERN.test(head);

  const resolveImage = (originalName: string) => {
    const actualFileName =
      imageMap?.[originalName] ||
      imageMap?.[`image/${originalName}`] ||
      originalName;
    const imagePath = bookImagePath(bookDirectory ?? "", bookFileName ?? "", actualFileName);
    return { actualFileName, imagePath };
  };

  const markImageUnavailable = (imagePath: string) =>
    setUnavailableImagePaths((previous) => new Set(previous).add(imagePath));

  const parseContentWithImages = (content: string) => {
    const parts: Array<{ type: "text" | "image"; content: string }> = [];
    let lastIndex = 0;
    const regex = /\[IMAGE:([^\]]+)\]/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const textBefore = content.substring(lastIndex, match.index);
        if (textBefore.trim()) {
          parts.push({ type: "text", content: textBefore });
        }
      }

      const imageName = match[1];
      parts.push({ type: "image", content: imageName });

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      const textAfter = content.substring(lastIndex);
      if (textAfter.trim()) {
        parts.push({ type: "text", content: textAfter });
      }
    }

    return parts;
  };

  const renderHeadWithImages = () => {
    if (showTranslation && translatedText) {
      return (
        <span style={{ color: mutedTextColor }}>
          {translatedText}
        </span>
      );
    }

    if (!hasImage) {
      return renderTextWithFurigana(head, true);
    }

    const parts = parseContentWithImages(head);

    return (
      <div className="head-content">
        {parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <div key={index} className="whitespace-pre-wrap">
                {renderTextWithFurigana(part.content, true)}
              </div>
            );
          } else {
            const { actualFileName, imagePath } = resolveImage(part.content);
            return (
              <BookImage
                key={index}
                fileName={actualFileName}
                imagePath={imagePath}
                altText={`Illustration from ${bookFileName}`}
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
        backgroundColor: toTint(accentColor, 10),
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
            borderLeft: `2px solid ${accentColor}`,
            backgroundColor: toTint(accentColor, 7),
          }
        : {};

  const buttonBaseStyle: React.CSSProperties = {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "2px",
    border: "none",
    background: "none",
    cursor: "pointer",
    transition: "transform 0.15s ease, background-color 0.15s ease",
    flexShrink: 0,
  };

  const hoverBg = isDarkMode
    ? toTint(DARK_COLORS.TEXT, 6)
    : toTint(COLORS.INK, 4);

  // A line whose original is only illustrations, none of which exist, would be an empty card.
  const headParts = hasImage ? parseContentWithImages(head) : [];
  const isOnlyUnavailableImages =
    headParts.length > 0 &&
    headParts.every(
      (part) => part.type === "image" && unavailableImagePaths.has(resolveImage(part.content).imagePath)
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
            color: isDarkMode ? DARK_COLORS.TEXT : COLORS.INK,
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
              style={{ color: accentColor, background: "none", border: "none", padding: 0 }}
            >
              やさしく
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                width="12"
                height="12"
                aria-hidden="true"
                style={{
                  fill: accentColor,
                  transition: "transform 200ms ease",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <path d="M297.4 470.6C309.9 483.1 330.2 483.1 342.7 470.6L534.7 278.6C547.2 266.1 547.2 245.8 534.7 233.3C522.2 220.8 501.9 220.8 489.4 233.3L320 402.7L150.6 233.4C138.1 220.9 117.8 220.9 105.3 233.4C92.8 245.9 92.8 266.2 105.3 278.7L297.3 470.7z" />
              </svg>
            </button>
          )}
          <span aria-hidden="true" className="flex-1 h-px" style={{ backgroundColor: ruleColor }} />
          <div className="flex items-center gap-0.5 flex-shrink-0 -mr-1.5">
            {audiobookEnabled && onStartFromHere && globalIndex != null && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartFromHere(globalIndex);
                }}
                style={buttonBaseStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = hoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.9)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
                aria-label="Set audio start here"
                title="Start audio from here"
              >
                <StartHereIcon isActive={isStartCursor} />
              </button>
            )}
            <TTSButton text={head} onLongPress={onStartContinuousPlay} />
            <button
              disabled={translating}
              onClick={handleTranslateClick}
              style={{
                ...buttonBaseStyle,
                opacity: translating ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = hoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = "scale(0.9)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
              aria-label="Translate"
            >
              <TranslateIcon isActive={showTranslation} />
            </button>
            <form
              onSubmit={handleSubmit}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex"
            >
              <button
                disabled={loading}
                type="submit"
                style={buttonBaseStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = hoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = "scale(0.9)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
                aria-label="Bookmark"
              >
                {isBookmarked ? <BookmarkFilled /> : <BookmarkUnfilled />}
              </button>
            </form>
          </div>
        </div>
        {isOpen && (
          <div
            className="mt-1 px-3 py-2.5 flex flex-col gap-2"
            style={{ backgroundColor: glossBackground }}
          >
            {subItems.map((subItem, index) => (
              <div
                key={index}
                className="sub-item-text"
                onClick={handleTripleClickSelect}
                style={{ color: mutedTextColor }}
              >
                {index === 4 ? "" : renderTextWithFurigana(subItem, false)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollapsibleItem;
