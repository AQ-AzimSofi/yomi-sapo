/**
 * The context size slider shows every step while it moves but commits (and so
 * asks the AI) only once it settles: on pointer release, on the release of a key
 * that moves it, or on blur.
 */
const SLIDER_STEP_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

export function isSliderStepKey(key: string): boolean {
  return SLIDER_STEP_KEYS.includes(key);
}

/** The size to commit once the slider settles, or null when there is nothing new to ask for. */
export function contextSizeToCommit(draft: number | null, committed: number): number | null {
  return draft === null || draft === committed ? null : draft;
}
