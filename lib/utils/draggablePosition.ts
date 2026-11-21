import { isRecord } from './typeGuards';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** How far the pointer travels before a press counts as a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 5;

/** Moves the top-left corner of a box of the given size just far enough to keep the box in the viewport. */
export function clampToViewport(position: Point, size: Size, viewport: Size): Point {
  return {
    x: Math.min(Math.max(0, position.x), viewport.width - size.width),
    y: Math.min(Math.max(0, position.y), viewport.height - size.height),
  };
}

export function passesDragThreshold(offset: Point): boolean {
  return Math.abs(offset.x) > DRAG_THRESHOLD_PX || Math.abs(offset.y) > DRAG_THRESHOLD_PX;
}

/** A position saved as {"x":..,"y":..}, or null when nothing usable is saved. */
export function parseStoredPosition(stored: string | null): Point | null {
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return null;
    const { x, y } = parsed;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}
