import { describe, expect, it } from 'vitest';
import { contextSizeToCommit, isSliderStepKey } from './contextSlider';

describe('isSliderStepKey', () => {
  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])('settles on the release of %s', (key) => {
    expect(isSliderStepKey(key)).toBe(true);
  });

  it.each(['Tab', 'Escape', 'Shift', 'a'])('ignores the release of %s', (key) => {
    expect(isSliderStepKey(key)).toBe(false);
  });
});

describe('contextSizeToCommit', () => {
  it('commits the value the slider settled on', () => {
    expect(contextSizeToCommit(80, 50)).toBe(80);
  });

  it('commits nothing when the slider was not moved', () => {
    expect(contextSizeToCommit(null, 50)).toBeNull();
  });

  it('commits nothing when the slider came back to the committed value', () => {
    expect(contextSizeToCommit(50, 50)).toBeNull();
  });
});
