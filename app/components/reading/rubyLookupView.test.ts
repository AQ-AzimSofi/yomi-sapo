import { describe, expect, it } from 'vitest';
import { rubyLookupView, type RubyLookupState } from './rubyLookupView';

const LISTED: RubyLookupState = { isLoading: false, isUnavailable: false, entryCount: 2, shownCount: 2 };

describe('rubyLookupView', () => {
  it('lists the entries the search leaves', () => {
    expect(rubyLookupView(LISTED)).toBe('entries');
  });

  it('shows the calm note, not the empty registry, on a server without the registry', () => {
    expect(rubyLookupView({ ...LISTED, isUnavailable: true, entryCount: 0, shownCount: 0 })).toBe('unavailable');
  });

  it('shows loading while a request is out', () => {
    expect(rubyLookupView({ ...LISTED, isLoading: true, isUnavailable: true })).toBe('loading');
  });

  it('offers to set up an empty registry', () => {
    expect(rubyLookupView({ ...LISTED, entryCount: 0, shownCount: 0 })).toBe('empty');
  });

  it('says nothing matched when the search or the starred filter leaves no entry', () => {
    expect(rubyLookupView({ ...LISTED, shownCount: 0 })).toBe('no-matches');
  });
});
