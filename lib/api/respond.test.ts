import { describe, expect, it } from 'vitest';
import { isRecord, isNonEmptyString } from '@/lib/utils/typeGuards';
import { apiError, internalError, parseJsonBody } from './respond';

interface Greeting {
  name: string;
}

function isGreeting(body: unknown): body is Greeting {
  return isRecord(body) && isNonEmptyString(body.name);
}

function postRequest(body: string): Request {
  return new Request('http://localhost/api/test', { method: 'POST', body });
}

async function rejectionOf(body: string): Promise<Response> {
  const result = await parseJsonBody(postRequest(body), isGreeting, 'name is required');
  if (!(result instanceof Response)) throw new Error(`Expected a 400 response, got ${JSON.stringify(result)}`);
  return result;
}

describe('apiError', () => {
  it('answers the status with the standard error body', async () => {
    const response = apiError(404, 'not_found', 'No such book');

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: { code: 'not_found', message: 'No such book' } });
  });
});

describe('internalError', () => {
  it('answers 500 with a generic message', async () => {
    const response = internalError();

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });
});

describe('parseJsonBody', () => {
  it('returns a body that passes the check', async () => {
    const body = await parseJsonBody(postRequest('{"name":"ほん"}'), isGreeting, 'name is required');

    expect(body).toStrictEqual({ name: 'ほん' });
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await rejectionOf('{name');

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: { code: 'invalid_json', message: 'Request body must be JSON' },
    });
  });

  it('answers 400 for an empty body', async () => {
    const response = await rejectionOf('');

    expect(response.status).toBe(400);
  });

  it('answers 400 with the requirement for a body that fails the check', async () => {
    const response = await rejectionOf('{"name":""}');

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: { code: 'invalid_body', message: 'name is required' },
    });
  });

  it('lets a failure that is not about the JSON propagate', async () => {
    const request = postRequest('{"name":"ほん"}');
    await request.text();

    await expect(parseJsonBody(request, isGreeting, 'name is required')).rejects.toThrow(TypeError);
  });
});
