import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { SignJWT } from 'jose';
import { config, middleware } from './middleware';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import { safeReturnPath } from '@/lib/auth/returnPath';

const ORIGIN = 'http://localhost:3333';
const SESSION_SECRET = 'test-session-secret-0123456789abcdef';
const OTHER_SECRET = 'other-session-secret-0123456789abcdef';

const PASS_THROUGH = { isPassThrough: true, redirectUrl: null };
function redirectToLogin(path: string) {
  return { isPassThrough: false, redirectUrl: `${ORIGIN}/login?${new URLSearchParams({ next: path })}` };
}

function isMatched(path: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}` });
}

function signSessionToken(secret: string, expiresAt: string | number = '7d'): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
}

async function runMiddleware(path: string, sessionToken?: string) {
  const headers = sessionToken ? { cookie: `session=${sessionToken}` } : undefined;
  const response = await middleware(new NextRequest(`${ORIGIN}${path}`, { headers }));
  return {
    isPassThrough: response.headers.get('x-middleware-next') === '1',
    redirectUrl: getRedirectUrl(response),
  };
}

function readerPath(directory: string, fileName: string): string {
  return `/read?${new URLSearchParams({ directory, fileName })}`;
}

describe('config.matcher', () => {
  it.each(['/', '/library', '/read', '/vocabulary', '/login'])('runs the middleware on page route %s', (path) => {
    expect(isMatched(path)).toBe(true);
  });

  it.each(['/api/auth', '/api/text-entries', '/_next/static/x.js', '/_next/image', '/favicon.ico', '/cover.png'])(
    'skips %s',
    (path) => {
      expect(isMatched(path)).toBe(false);
    }
  );

  it.each(['/api-docs', '/apis', '/api'])('runs the middleware on page route %s, whose name only starts with api', (path) => {
    expect(isMatched(path)).toBe(true);
  });
});

describe('middleware', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', SESSION_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets a guest open /login', async () => {
    expect(await runMiddleware('/login')).toEqual(PASS_THROUGH);
  });

  it.each(['/loginx', '/login-admin', '/login/extra'])('redirects a guest opening %s, which only starts with /login', async (path) => {
    expect(await runMiddleware(path)).toEqual(redirectToLogin(path));
  });

  it('lets a guest open the home page', async () => {
    expect(await runMiddleware('/')).toEqual(PASS_THROUGH);
  });

  it('lets a guest open the library', async () => {
    expect(await runMiddleware('/library')).toEqual(PASS_THROUGH);
  });

  it('lets a guest open the reader for an allowlisted book', async () => {
    const { directory, fileName } = PUBLIC_BOOKS[0];

    expect(await runMiddleware(readerPath(directory, fileName))).toEqual(PASS_THROUGH);
  });

  it('redirects a guest opening the reader for a book not on the allowlist', async () => {
    const path = readerPath('bookv2-furigana/ひみつの本', 'ひみつの本-rephrase-furigana');

    expect(await runMiddleware(path)).toEqual(redirectToLogin(path));
  });

  it('sends a guest to the login page with the locked reader path and query in next', async () => {
    const path = readerPath('bookv2-furigana/ひみつの本', 'ひみつの本-rephrase-furigana');

    const { redirectUrl } = await runMiddleware(path);

    expect(new URL(redirectUrl ?? '').searchParams.get('next')).toBe(path);
  });

  it('hands the login page a next path that the sign-in returns to unchanged', async () => {
    const path = `${readerPath('bookv2-furigana/ひみつの本', 'ひみつの本-rephrase-furigana')}&page=3`;

    const { redirectUrl } = await runMiddleware(path);

    expect(safeReturnPath(new URL(redirectUrl ?? '').searchParams.get('next'))).toBe(path);
  });

  it('redirects a guest opening the reader without a book', async () => {
    expect(await runMiddleware('/read')).toEqual(redirectToLogin('/read'));
  });

  it('redirects a guest opening the reader with an allowlisted directory but another file', async () => {
    const path = readerPath(PUBLIC_BOOKS[0].directory, 'ひみつの本-rephrase-furigana');

    expect(await runMiddleware(path)).toEqual(redirectToLogin(path));
  });

  it('redirects a guest opening the vocabulary page', async () => {
    expect(await runMiddleware('/vocabulary')).toEqual(redirectToLogin('/vocabulary'));
  });

  it('lets a valid session open the vocabulary page', async () => {
    const token = await signSessionToken(SESSION_SECRET);

    expect(await runMiddleware('/vocabulary', token)).toEqual(PASS_THROUGH);
  });

  it('lets a valid session open the reader for any book', async () => {
    const token = await signSessionToken(SESSION_SECRET);
    const path = readerPath('bookv2-furigana/ひみつの本', 'ひみつの本-rephrase-furigana');

    expect(await runMiddleware(path, token)).toEqual(PASS_THROUGH);
  });

  it('treats a malformed session token as a guest', async () => {
    expect(await runMiddleware('/vocabulary', 'not-a-jwt')).toEqual(redirectToLogin('/vocabulary'));
  });

  it('treats a token signed with another secret as a guest', async () => {
    const token = await signSessionToken(OTHER_SECRET);

    expect(await runMiddleware('/vocabulary', token)).toEqual(redirectToLogin('/vocabulary'));
  });

  it('treats an expired session token as a guest', async () => {
    const expiredAtSecs = Math.floor(Date.now() / 1000) - 60;
    const token = await signSessionToken(SESSION_SECRET, expiredAtSecs);

    expect(await runMiddleware('/vocabulary', token)).toEqual(redirectToLogin('/vocabulary'));
  });

  it('still lets a guest with an invalid token open the library', async () => {
    expect(await runMiddleware('/library', 'not-a-jwt')).toEqual(PASS_THROUGH);
  });

  it('treats every session as a guest when SESSION_SECRET is unset', async () => {
    const token = await signSessionToken(SESSION_SECRET);
    vi.stubEnv('SESSION_SECRET', undefined);

    expect(await runMiddleware('/vocabulary', token)).toEqual(redirectToLogin('/vocabulary'));
  });
});
