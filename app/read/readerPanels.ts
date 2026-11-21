/** The overlays that take over the reader. At most one is open at a time. */
export type ReaderPanel = 'settings' | 'explanation' | 'ruby' | 'copyRange';

export type ActivePanel = ReaderPanel | null;

/** Opens the panel in place of whichever one is open, or closes it when it is the open one. */
export function togglePanel(active: ActivePanel, panel: ReaderPanel): ActivePanel {
  return active === panel ? null : panel;
}

/** Closes the panel without touching another panel that has since replaced it. */
export function closePanel(active: ActivePanel, panel: ReaderPanel): ActivePanel {
  return active === panel ? null : active;
}

interface KeyTarget {
  tagName: string;
  isContentEditable: boolean;
}

const TEXT_ENTRY_TAGS = ['INPUT', 'TEXTAREA'];

/** Audio shortcuts act only while no panel is open and the reader is not typing. */
export function acceptsAudioShortcut(active: ActivePanel, target: KeyTarget | null): boolean {
  if (active !== null) return false;
  if (!target) return true;
  return !TEXT_ENTRY_TAGS.includes(target.tagName) && !target.isContentEditable;
}
