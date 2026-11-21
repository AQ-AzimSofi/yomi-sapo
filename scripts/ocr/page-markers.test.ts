import { describe, expect, it } from 'vitest';
import { findStrayMarker } from './page-markers';

describe('findStrayMarker', () => {
  it('Test_findStrayMarker_LeadingContinuationIsAllowed', () => {
    expect(findStrayMarker('<<CONTINUED>>本文')).toBeUndefined();
  });

  it('Test_findStrayMarker_CroppedFigureIsAllowed', () => {
    expect(findStrayMarker('本文\n[IMAGE:page-001-1.png]')).toBeUndefined();
  });

  it('Test_findStrayMarker_FigureInsideALine', () => {
    expect(findStrayMarker('本文<<FIGURE 1 2 3 4>>本文')).toBe('<<FIGURE 1 2 3 4>>');
  });

  it('Test_findStrayMarker_ContinuationAfterAFigure', () => {
    expect(findStrayMarker('[IMAGE:page-001-1.png]\n<<CONTINUED>>本文')).toBe('<<CONTINUED>>');
  });

  it('Test_findStrayMarker_NoTextBesideAFigure', () => {
    expect(findStrayMarker('[IMAGE:page-001-1.png]\n<<NO_TEXT>>')).toBe('<<NO_TEXT>>');
  });
});
