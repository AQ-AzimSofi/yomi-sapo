import { describe, expect, it } from 'vitest';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import { loginPathReturningTo } from './loginPath';
import { safeReturnPath } from './returnPath';

const ORIGIN = 'http://localhost:3333';

// Built the way the browser reports it: the query comes back percent-encoded.
function readerLocation(page: string): URL {
  const { directory, fileName } = PUBLIC_BOOKS[0];
  return new URL(`/read?${new URLSearchParams({ directory, fileName, page })}`, ORIGIN);
}

function nextParamOf(loginPath: string): string | null {
  return new URL(loginPath, ORIGIN).searchParams.get('next');
}

describe('loginPathReturningTo', () => {
  it('sends the visitor to the login page with the page they were on in next', () => {
    expect(loginPathReturningTo({ pathname: '/library', search: '' })).toBe('/login?next=%2Flibrary');
  });

  it('keeps the reader query in next', () => {
    const location = readerLocation('3');

    expect(nextParamOf(loginPathReturningTo(location))).toBe(`${location.pathname}${location.search}`);
  });

  it('leaves out the hash, which the middleware never sees either', () => {
    expect(loginPathReturningTo(new URL('/library#top', ORIGIN))).toBe('/login?next=%2Flibrary');
  });

  it('hands the login page a next path that the sign-in returns to unchanged', () => {
    const location = readerLocation('3');

    expect(safeReturnPath(nextParamOf(loginPathReturningTo(location)))).toBe(`${location.pathname}${location.search}`);
  });

  it('round-trips the library through the sign-in', () => {
    expect(safeReturnPath(nextParamOf(loginPathReturningTo({ pathname: '/library', search: '' })))).toBe('/library');
  });
});
