import { describe, expect, it } from 'vitest';
import { acceptsAudioShortcut, closePanel, togglePanel, type ReaderPanel } from './readerPanels';

const PANELS: ReaderPanel[] = ['settings', 'explanation', 'ruby', 'copyRange'];
const PAGE_BODY = { tagName: 'BODY', isContentEditable: false };

describe('togglePanel', () => {
  it('opens a panel when none is open', () => {
    expect(togglePanel(null, 'ruby')).toBe('ruby');
  });

  it('closes the panel when it is the open one', () => {
    expect(togglePanel('ruby', 'ruby')).toBeNull();
  });

  it.each(PANELS.filter((panel) => panel !== 'ruby'))('replaces an open %s panel', (open) => {
    expect(togglePanel(open, 'ruby')).toBe('ruby');
  });
});

describe('closePanel', () => {
  it('closes the panel when it is the open one', () => {
    expect(closePanel('copyRange', 'copyRange')).toBeNull();
  });

  it('leaves open a panel that replaced the one closing', () => {
    expect(closePanel('ruby', 'copyRange')).toBe('ruby');
  });

  it('leaves the reader with no panel when none was open', () => {
    expect(closePanel(null, 'settings')).toBeNull();
  });
});

describe('acceptsAudioShortcut', () => {
  it('accepts a key pressed on the page with no panel open', () => {
    expect(acceptsAudioShortcut(null, PAGE_BODY)).toBe(true);
  });

  it('accepts a key with no target', () => {
    expect(acceptsAudioShortcut(null, null)).toBe(true);
  });

  it.each(PANELS)('ignores keys while the %s panel is open', (panel) => {
    expect(acceptsAudioShortcut(panel, PAGE_BODY)).toBe(false);
  });

  it.each(['INPUT', 'TEXTAREA'])('ignores keys typed into an %s', (tagName) => {
    expect(acceptsAudioShortcut(null, { tagName, isContentEditable: false })).toBe(false);
  });

  it('ignores keys typed into editable content', () => {
    expect(acceptsAudioShortcut(null, { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });
});
