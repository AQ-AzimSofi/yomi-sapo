import { NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE } from '@/lib/auth/session';
import { withAuth } from '@/lib/auth/guards';
import { apiError, errorBody, parseJsonBody } from '@/lib/api/respond';
import type { ApiErrorCode, AuthResponse, SessionResponse } from '@/lib/api/contracts';
import { isRecord } from '@/lib/utils/typeGuards';

/**
 * Consolidated authentication API route
 * Handles login, logout, and session verification with action routing
 *
 * POST /api/auth?action=login - Authenticate user
 * POST /api/auth?action=logout - Clear session
 * GET /api/auth?action=session - Check authentication status
 */

export const POST = withAuth('public', async (request) => {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'login') {
    return handleLogin(request);
  } else if (action === 'logout') {
    return handleLogout();
  }

  return apiError(400, 'invalid_request', 'Invalid action. Use action=login or action=logout');
});

export const GET = withAuth('viewer', async (request, viewer) => {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'session') {
    return NextResponse.json<SessionResponse>({ authenticated: viewer === 'owner' });
  }

  return apiError(400, 'invalid_request', 'Invalid action. Use action=session');
});

// The login page shows the top-level message of any failed login.
function loginError(status: number, code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json({ ...errorBody(code, message), message }, { status });
}

// Login handler (uses bcrypt - Node.js runtime required)
async function handleLogin(request: Request) {
  const body = await parseJsonBody(request, isRecord, 'Password is required');
  if (body instanceof Response) return body;
  const { password } = body;

  if (typeof password !== 'string' || !password) {
    return loginError(400, 'invalid_body', 'Password is required');
  }

  try {
    const isValid = await verifyPassword(password);

    if (!isValid) {
      return loginError(401, 'invalid_password', 'Invalid password');
    }

    // Create session
    const sessionToken = await createSession();

    // Set cookie
    const response = NextResponse.json<AuthResponse>({
      message: 'Login successful',
      success: true
    });

    // COOKIE_SECURE=false allows HTTP in production (e.g., before SSL setup)
    const isSecure = process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';

    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return loginError(500, 'internal_error', 'Login failed');
  }
}

// Logout handler
async function handleLogout() {
  const response = NextResponse.json<AuthResponse>({
    message: 'Logged out successfully',
    success: true
  });

  // Delete session cookie
  response.cookies.delete(SESSION_COOKIE);

  return response;
}
