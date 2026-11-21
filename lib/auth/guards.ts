import 'server-only';
import { NextResponse } from 'next/server';
import type { GuestKeyKind } from '@/lib/guestKeys';
import { apiError, errorBody, internalError, type ApiErrorBody } from '@/lib/api/respond';
import { SESSION_COOKIE, verifySession } from './session';

/** Who is calling: the signed-in owner, or anyone without a valid session. */
export type Viewer = 'owner' | 'guest';

/**
 * - owner: a valid session is required; anyone else gets 401.
 * - viewer: the handler receives the Viewer and decides (guest previews, guest keys).
 * - admin-key: the x-api-key header must equal ADMIN_API_KEY.
 * - public: no check.
 */
export type AccessPolicy = 'owner' | 'viewer' | 'admin-key' | 'public';

type RouteHandler<Context extends unknown[]> = (request: Request, ...context: Context) => Promise<Response>;
type ViewerRouteHandler = (request: Request, viewer: Viewer) => Promise<Response>;

export type GuardedRoute<Context extends unknown[]> = RouteHandler<Context> & {
  readonly accessPolicy: AccessPolicy;
};

function readCookie(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  return (request.headers.get('cookie') ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(prefix))
    ?.slice(prefix.length);
}

export async function getViewer(request: Request): Promise<Viewer> {
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!sessionToken) return 'guest';
  return (await verifySession(sessionToken)) ? 'owner' : 'guest';
}

function hasAdminKey(request: Request): boolean {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) {
    console.warn('ADMIN_API_KEY not configured');
    return false;
  }
  return request.headers.get('x-api-key') === adminApiKey;
}

function adminKeyRequired(): NextResponse<ApiErrorBody> {
  return apiError(401, 'admin_key_required', 'Valid API key required. Include "x-api-key" header with your ADMIN_API_KEY.');
}

export function signInRequired(): NextResponse<ApiErrorBody> {
  return apiError(401, 'sign_in_required', 'Sign in required');
}

/** For a guest asking for a book, or part of one, outside the preview allowlist. */
export function guestPreviewOnly(): NextResponse<ApiErrorBody> {
  return apiError(403, 'preview_only', 'Guests may only open the preview books');
}

const GUEST_KEY_NAMES: Record<GuestKeyKind, string> = {
  gemini: 'Gemini API key',
  tts: 'Google TTS API key',
  translate: 'Google Translate API key',
};

/** A guest called a paid route without their own key; requiresGuestKey opens the key modal. */
export function guestKeyRequired(kind: GuestKeyKind): NextResponse {
  return NextResponse.json(
    {
      ...errorBody('guest_key_required', `Sign in or add your own ${GUEST_KEY_NAMES[kind]}.`),
      requiresGuestKey: kind,
    },
    { status: 401 }
  );
}

// Each policy either rejects the request or yields the arguments the handler gets after the request.
type Admission = (request: Request, context: unknown[]) => Promise<Response | unknown[]>;

const ADMISSIONS: Record<AccessPolicy, Admission> = {
  owner: async (request, context) => ((await getViewer(request)) === 'owner' ? context : signInRequired()),
  viewer: async (request) => [await getViewer(request)],
  'admin-key': async (request, context) => (hasAdminKey(request) ? context : adminKeyRequired()),
  public: async (_request, context) => context,
};

/**
 * Wraps a route handler in its access policy and marks it with that policy, so a
 * test can find a route that declares none. A failure the handler does not handle
 * is logged and answered with a generic 500 that does not leak the exception text.
 */
export function withAuth(policy: 'viewer', handler: ViewerRouteHandler): GuardedRoute<[]>;
export function withAuth<Context extends unknown[]>(
  policy: Exclude<AccessPolicy, 'viewer'>,
  handler: RouteHandler<Context>
): GuardedRoute<Context>;
export function withAuth(policy: AccessPolicy, handler: RouteHandler<never[]>): GuardedRoute<unknown[]> {
  const guarded = async (request: Request, ...context: unknown[]): Promise<Response> => {
    try {
      const admission = await ADMISSIONS[policy](request, context);
      if (admission instanceof Response) return admission;
      // The overloads pair each policy with the handler shape its admission yields.
      return await handler(request, ...(admission as never[]));
    } catch (error) {
      console.error(`Unhandled error in ${request.method} ${new URL(request.url).pathname}:`, error);
      return internalError();
    }
  };
  return Object.assign(guarded, { accessPolicy: policy });
}
