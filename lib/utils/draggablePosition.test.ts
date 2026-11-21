import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  clampToViewport,
  dragStep,
  parseStoredPosition,
  passesDragThreshold,
  restoredPosition,
} from './draggablePosition';

const VIEWPORT = { width: 1280, height: 800 };
const FAB = { width: 52, height: 52 };

describe('clampToViewport', () => {
  it('leaves a position that fits where it is', () => {
    expect(clampToViewport({ x: 900, y: 500 }, FAB, VIEWPORT)).toStrictEqual({ x: 900, y: 500 });
  });

  it('pulls a box past the right and bottom edges back so it ends at them', () => {
    expect(clampToViewport({ x: 3000, y: 3000 }, FAB, VIEWPORT)).toStrictEqual({ x: 1228, y: 748 });
  });

  it('pulls a box past the left and top edges back to them', () => {
    expect(clampToViewport({ x: -40, y: -10 }, FAB, VIEWPORT)).toStrictEqual({ x: 0, y: 0 });
  });

  it('keeps a wide box whole on screen by its width and a short handle by its height', () => {
    expect(clampToViewport({ x: 1100, y: 790 }, { width: 280, height: 44 }, VIEWPORT)).toStrictEqual({ x: 1000, y: 756 });
  });

  it('accepts a box that exactly fills the remaining space', () => {
    expect(clampToViewport({ x: 1228, y: 748 }, FAB, VIEWPORT)).toStrictEqual({ x: 1228, y: 748 });
  });
});

describe('passesDragThreshold', () => {
  it('treats a move of the threshold itself as a click', () => {
    expect(passesDragThreshold({ x: DRAG_THRESHOLD_PX, y: -DRAG_THRESHOLD_PX })).toBe(false);
  });

  it.each([
    [{ x: DRAG_THRESHOLD_PX + 1, y: 0 }],
    [{ x: 0, y: -(DRAG_THRESHOLD_PX + 1) }],
  ])('treats a move past the threshold on either axis as a drag: %o', (offset) => {
    expect(passesDragThreshold(offset)).toBe(true);
  });
});

describe('parseStoredPosition', () => {
  it('reads the position format the FAB and sticky notes have always saved', () => {
    expect(parseStoredPosition('{"x":900,"y":500}')).toStrictEqual({ x: 900, y: 500 });
  });

  it('returns null when nothing is saved', () => {
    expect(parseStoredPosition(null)).toBeNull();
  });

  it.each(['not json', '[1,2]', '{"x":1}', '{"x":"1","y":2}', '{"x":null,"y":2}', '5'])(
    'returns null for the unusable value %s',
    (stored) => {
      expect(parseStoredPosition(stored)).toBeNull();
    }
  );
});

describe('dragStep', () => {
  const press = { pointerStart: { x: 100, y: 100 }, positionStart: { x: 600, y: 400 }, hasMoved: false };

  it('leaves a press that stays inside the threshold a click', () => {
    expect(dragStep({ gesture: press, pointer: { x: 103, y: 97 }, size: FAB, viewport: VIEWPORT })).toBeNull();
  });

  it('moves the box by the pointer offset once the press passes the threshold', () => {
    expect(dragStep({ gesture: press, pointer: { x: 140, y: 80 }, size: FAB, viewport: VIEWPORT })).toStrictEqual({
      gesture: { ...press, hasMoved: true },
      position: { x: 640, y: 380 },
    });
  });

  it('keeps following the pointer back inside the threshold once the press became a drag', () => {
    const drag = { ...press, hasMoved: true };

    expect(dragStep({ gesture: drag, pointer: { x: 102, y: 101 }, size: FAB, viewport: VIEWPORT })?.position).toStrictEqual({ x: 602, y: 401 });
  });

  it('keeps the dragged box inside the viewport', () => {
    expect(dragStep({ gesture: press, pointer: { x: 3000, y: 3000 }, size: FAB, viewport: VIEWPORT })?.position).toStrictEqual({ x: 1228, y: 748 });
  });
});

describe('restoredPosition', () => {
  const defaultPosition = { x: 1200, y: 700 };

  it('restores the saved position', () => {
    expect(restoredPosition({ stored: '{"x":900,"y":500}', size: FAB, viewport: VIEWPORT, defaultPosition })).toStrictEqual({ x: 900, y: 500 });
  });

  it('pulls a position saved in a larger window back into the viewport', () => {
    expect(restoredPosition({ stored: '{"x":1800,"y":1000}', size: FAB, viewport: VIEWPORT, defaultPosition })).toStrictEqual({ x: 1228, y: 748 });
  });

  it.each([null, 'not json'])('starts at the default position when the saved value is %s', (stored) => {
    expect(restoredPosition({ stored, size: FAB, viewport: VIEWPORT, defaultPosition })).toStrictEqual(defaultPosition);
  });
});
