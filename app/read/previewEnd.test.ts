import { describe, expect, it } from 'vitest';
import { showsPreviewEnd } from './previewEnd';

describe('showsPreviewEnd', () => {
  it('shows the card to a guest on the last preview page', () => {
    expect(showsPreviewEnd({ isGuest: true, currentPage: 5, totalPages: 5 })).toBe(true);
  });

  it.each([1, 4])('hides the card from a guest on the earlier page %i', (currentPage) => {
    expect(showsPreviewEnd({ isGuest: true, currentPage, totalPages: 5 })).toBe(false);
  });

  it.each([1, 5])('never shows the card to the owner, here on page %i of 5', (currentPage) => {
    expect(showsPreviewEnd({ isGuest: false, currentPage, totalPages: 5 })).toBe(false);
  });

  it('shows the card to a guest whose preview is one page long', () => {
    expect(showsPreviewEnd({ isGuest: true, currentPage: 1, totalPages: 1 })).toBe(true);
  });

  it('shows the card to a guest whose preview came back empty, since there is nothing left to read', () => {
    expect(showsPreviewEnd({ isGuest: true, currentPage: 1, totalPages: 0 })).toBe(true);
  });
});
