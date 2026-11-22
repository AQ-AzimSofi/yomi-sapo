/** What the word lookup panel's list area shows. */
export type RubyLookupView = 'loading' | 'unavailable' | 'empty' | 'no-matches' | 'entries';

export interface RubyLookupState {
  isLoading: boolean;
  isUnavailable: boolean;
  // Words in the book's registry, and how many of them the search and the starred filter leave.
  entryCount: number;
  shownCount: number;
}

// A server without the registry (production before the move to Aurora DSQL) gets a calm note
// instead of the empty registry's set-up link, since saving there fails too.
export function rubyLookupView({ isLoading, isUnavailable, entryCount, shownCount }: RubyLookupState): RubyLookupView {
  if (isLoading) return 'loading';
  if (isUnavailable) return 'unavailable';
  if (entryCount === 0) return 'empty';
  if (shownCount === 0) return 'no-matches';
  return 'entries';
}

export const RUBY_LOOKUP_UNAVAILABLE_MESSAGE = 'The word list is not available here yet.';
