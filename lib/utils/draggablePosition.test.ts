import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, clampToViewport, parseStoredPosition, passesDragThreshold } from './draggablePosition';

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
