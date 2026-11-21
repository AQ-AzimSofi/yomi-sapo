/**
 * Test helpers: sign session tokens the way /api/auth does, so route tests can
 * send a real session cookie instead of mocking the guard. Stub SESSION_SECRET
 * with TEST_SESSION_SECRET for the cookie to verify.
 */
import { SignJWT } from 'jose';
import { SESSION_COOKIE } from './session';

export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

export function signSessionToken(secret: string, expiresAt: string | number = '7d'): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
}

/** Request headers carrying a valid owner session signed with TEST_SESSION_SECRET. */
export async function ownerSessionHeaders(): Promise<{ cookie: string }> {
  return { cookie: `${SESSION_COOKIE}=${await signSessionToken(TEST_SESSION_SECRET)}` };
}
