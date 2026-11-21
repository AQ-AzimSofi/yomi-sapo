import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '@/lib/auth/password';
import { getViewer } from '@/lib/auth/guards';
import { ownerSessionHeaders, signSessionToken, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { GET, POST } from './route';

vi.mock('@/lib/auth/password', () => ({ verifyPassword: vi.fn() }));

const OWNER_HEADERS = await ownerSessionHeaders();
const SESSION_URL = 'http://localhost/api/auth?action=session';

function loginRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth?action=login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sessionCookieOf(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0];
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/auth?action=session', () => {
  it('reports a guest as signed out', async () => {
    const response = await GET(new Request(SESSION_URL));

    expect(await response.json()).toStrictEqual({ authenticated: false });
  });

  it('reports the owner as signed in', async () => {
    const response = await GET(new Request(SESSION_URL, { headers: OWNER_HEADERS }));

    expect(await response.json()).toStrictEqual({ authenticated: true });
  });

  it('reports an expired session as signed out', async () => {
    const expiredToken = await signSessionToken(TEST_SESSION_SECRET, Math.floor(Date.now() / 1000) - 60);

    const response = await GET(new Request(SESSION_URL, { headers: { cookie: `session=${expiredToken}` } }));

    expect(await response.json()).toStrictEqual({ authenticated: false });
  });
});

describe('POST /api/auth?action=login', () => {
  it('sets a session cookie the route guard accepts', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const response = await POST(loginRequest({ password: 'correct' }));

    expect(await response.json()).toStrictEqual({ message: 'Login successful', success: true });
    const signedInRequest = new Request('http://localhost/api/test', { headers: { cookie: sessionCookieOf(response) } });
    expect(await getViewer(signedInRequest)).toBe('owner');
  });

  it('answers 401 with the top-level message the login page shows', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await POST(loginRequest({ password: 'wrong' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: { code: 'invalid_password', message: 'Invalid password' },
      message: 'Invalid password',
    });
  });

  it('answers 400 with the top-level message when there is no password', async () => {
    const response = await POST(loginRequest({}));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('Password is required');
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('answers 500 with the top-level message when a session cannot be made', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('SESSION_SECRET', '');
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const response = await POST(loginRequest({ password: 'correct' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      error: { code: 'internal_error', message: 'Login failed' },
      message: 'Login failed',
    });
    error.mockRestore();
  });
});

describe('POST /api/auth?action=logout', () => {
  it('clears the session cookie', async () => {
    const response = await POST(new Request('http://localhost/api/auth?action=logout', { method: 'POST' }));

    expect(response.headers.get('set-cookie')).toMatch(/^session=;/);
  });
});
