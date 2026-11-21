import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getViewer, guestKeyRequired, withAuth, type Viewer } from './guards';
import { ownerSessionHeaders, signSessionToken, TEST_SESSION_SECRET } from './testSession';

const OTHER_SECRET = 'other-session-secret-0123456789abcdef';
const OWNER_HEADERS = await ownerSessionHeaders();
const ADMIN_API_KEY = 'admin-key-0123';

function routeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { headers });
}

function sessionHeaders(token: string): Record<string, string> {
  return { cookie: `session=${token}` };
}

const answerOk = vi.fn(async () => Response.json({ ok: true }));

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('ADMIN_API_KEY', ADMIN_API_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('getViewer', () => {
  it('sees the owner in a valid session cookie', async () => {
    expect(await getViewer(routeRequest(OWNER_HEADERS))).toBe('owner');
  });

  it('finds the session among other cookies', async () => {
    const token = await signSessionToken(TEST_SESSION_SECRET);

    expect(await getViewer(routeRequest({ cookie: `theme=dark; session=${token}; lang=ja` }))).toBe('owner');
  });

  it('sees a guest when there is no cookie', async () => {
    expect(await getViewer(routeRequest())).toBe('guest');
  });

  it('sees a guest when the session has expired', async () => {
    const expiredToken = await signSessionToken(TEST_SESSION_SECRET, Math.floor(Date.now() / 1000) - 60);

    expect(await getViewer(routeRequest(sessionHeaders(expiredToken)))).toBe('guest');
  });

  it('sees a guest when the session was signed with another secret', async () => {
    const forgedToken = await signSessionToken(OTHER_SECRET);

    expect(await getViewer(routeRequest(sessionHeaders(forgedToken)))).toBe('guest');
  });

  it('sees a guest when the session cookie is not a token', async () => {
    expect(await getViewer(routeRequest(sessionHeaders('not-a-jwt')))).toBe('guest');
  });

  it('does not take a cookie whose name only ends in session', async () => {
    const token = await signSessionToken(TEST_SESSION_SECRET);

    expect(await getViewer(routeRequest({ cookie: `oldsession=${token}` }))).toBe('guest');
  });

  it('finds the session after a cookie whose name only ends in session', async () => {
    const token = await signSessionToken(TEST_SESSION_SECRET);

    expect(await getViewer(routeRequest({ cookie: `oldsession=junk; session=${token}` }))).toBe('owner');
  });

  it('sees a guest when SESSION_SECRET is not set', async () => {
    vi.stubEnv('SESSION_SECRET', '');

    expect(await getViewer(routeRequest(OWNER_HEADERS))).toBe('guest');
  });
});

describe("withAuth('owner')", () => {
  const route = withAuth('owner', answerOk);

  it('runs the handler for the signed-in owner', async () => {
    const response = await route(routeRequest(OWNER_HEADERS));

    expect(response.status).toBe(200);
    expect(answerOk).toHaveBeenCalledOnce();
  });

  it('answers a guest 401 with the standard error body without running the handler', async () => {
    const response = await route(routeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({ error: { code: 'sign_in_required', message: 'Sign in required' } });
    expect(answerOk).not.toHaveBeenCalled();
  });

  it('passes the route context through to the handler', async () => {
    const readId = vi.fn(async (_request: Request, { params }: { params: Promise<{ id: string }> }) =>
      Response.json({ id: (await params).id })
    );
    const routeWithParams = withAuth('owner', readId);

    const response = await routeWithParams(routeRequest(OWNER_HEADERS), { params: Promise.resolve({ id: 'entry-1' }) });

    expect(await response.json()).toStrictEqual({ id: 'entry-1' });
  });
});

describe("withAuth('viewer')", () => {
  const answerViewer = vi.fn(async (_request: Request, viewer: Viewer) => Response.json({ viewer }));
  const route = withAuth('viewer', answerViewer);

  it.each([
    ['owner', OWNER_HEADERS],
    ['guest', {}],
  ])('hands the handler the %s', async (viewer, headers) => {
    const response = await route(routeRequest(headers));

    expect(await response.json()).toStrictEqual({ viewer });
  });
});

describe("withAuth('admin-key')", () => {
  const route = withAuth('admin-key', answerOk);

  it('runs the handler when x-api-key matches ADMIN_API_KEY', async () => {
    const response = await route(routeRequest({ 'x-api-key': ADMIN_API_KEY }));

    expect(response.status).toBe(200);
    expect(answerOk).toHaveBeenCalledOnce();
  });

  it.each([
    ['a wrong key', { 'x-api-key': 'guess' }],
    ['no key', {}],
    ['an owner session but no key', OWNER_HEADERS],
  ])('answers 401 for %s', async (_case, headers) => {
    const response = await route(routeRequest(headers));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('admin_key_required');
    expect(answerOk).not.toHaveBeenCalled();
  });

  it('answers 401 to every key, and warns, when ADMIN_API_KEY is not set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('ADMIN_API_KEY', '');

    const response = await route(routeRequest({ 'x-api-key': '' }));

    expect(response.status).toBe(401);
    expect(warn).toHaveBeenCalledWith('ADMIN_API_KEY not configured');
    warn.mockRestore();
  });
});

describe("withAuth('public')", () => {
  it('runs the handler without a session', async () => {
    const response = await withAuth('public', answerOk)(routeRequest());

    expect(response.status).toBe(200);
  });
});

describe('withAuth', () => {
  it.each(['owner', 'admin-key', 'public'] as const)('marks the %s handler with its policy', (policy) => {
    expect(withAuth(policy, answerOk).accessPolicy).toBe(policy);
  });

  it('marks the viewer handler with its policy', () => {
    expect(withAuth('viewer', answerOk).accessPolicy).toBe('viewer');
  });

  it('logs a failure the handler did not handle and answers a generic 500', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('password authentication failed for user "postgres"');
    const route = withAuth('public', async () => {
      throw failure;
    });

    const response = await route(new Request('http://localhost/api/test?fileName=x', { method: 'POST' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: { code: 'internal_error', message: 'Internal server error' } });
    expect(error).toHaveBeenCalledWith('Unhandled error in POST /api/test:', failure);
    error.mockRestore();
  });
});

describe('guestKeyRequired', () => {
  it.each([
    ['gemini', 'Sign in or add your own Gemini API key.'],
    ['tts', 'Sign in or add your own Google TTS API key.'],
    ['translate', 'Sign in or add your own Google Translate API key.'],
  ] as const)('answers 401 with requiresGuestKey for %s, which the key modal reads', async (kind, message) => {
    const response = guestKeyRequired(kind);

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: { code: 'guest_key_required', message },
      requiresGuestKey: kind,
    });
  });
});
