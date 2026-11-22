"use client";

import type { ButtonHTMLAttributes, CSSProperties, MouseEvent } from "react";
import { THEME } from "@/lib/constants";

const ICON_BUTTON_STYLE: CSSProperties = {
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

function tint(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.backgroundColor = THEME.HOVER;
}

function clearTint(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.backgroundColor = "transparent";
}

function pressIn(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "scale(0.9)";
}

function release(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "scale(1)";
}

/** A 32px square button for a reading item's action, tinted on hover and pressed in while held. */
export default function IconButton({ style, ...buttonProps }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...buttonProps}
      style={{ ...ICON_BUTTON_STYLE, ...style }}
      onMouseEnter={tint}
      onMouseLeave={clearTint}
      onMouseDown={pressIn}
      onMouseUp={release}
    />
  );
}
