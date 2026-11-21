import 'server-only';
import { NextResponse } from 'next/server';
import type { ApiErrorBody, ApiErrorCode } from './contracts';

/** The standard error body, for the few responses that add fields older clients still read. */
export function errorBody(code: ApiErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function apiError(status: number, code: ApiErrorCode, message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json(errorBody(code, message), { status });
}

/** The answer to a failure the route did not expect; the details stay in the server log. */
export function internalError(): NextResponse<ApiErrorBody> {
  return apiError(500, 'internal_error', 'Internal server error');
}

export type BodyCheck<T> = (body: unknown) => body is T;

const NOT_JSON = Symbol('not json');

/**
 * Reads a JSON request body and checks its shape. Answers 400 with `requirement`
 * as the message when the body is not JSON or does not pass `matches`.
 */
export async function parseJsonBody<T>(
  request: Request,
  matches: BodyCheck<T>,
  requirement: string
): Promise<T | NextResponse<ApiErrorBody>> {
  const body: unknown = await request.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) return NOT_JSON;
    throw error;
  });
  if (body === NOT_JSON) {
    return apiError(400, 'invalid_json', 'Request body must be JSON');
  }
  if (!matches(body)) {
    return apiError(400, 'invalid_body', requirement);
  }
  return body;
}
