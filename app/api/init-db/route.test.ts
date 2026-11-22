import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { applySchema } from '@/lib/db/schemaRunner';
import { GET as initDb } from './route';

vi.mock('@/lib/db/connection', () => ({ sql: { unsafe: vi.fn() }, databaseKind: 'dsql' }));
vi.mock('@/lib/db/schemaRunner', () => ({ applySchema: vi.fn() }));

const OWNER_HEADERS = await ownerSessionHeaders();

function initDbRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/init-db', { headers });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// The app's database role on DSQL may not run DDL; the schema is applied as admin by scripts/db/apply-schema-dsql.ts.
describe('GET /api/init-db on Aurora DSQL', () => {
  it('refuses a signed-in owner without applying the schema', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await initDb(initDbRequest(OWNER_HEADERS));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('refuses on the local dev server too', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await initDb(initDbRequest());

    expect(response.status).toBe(409);
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('still answers a guest in production with sign-in required', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await initDb(initDbRequest());

    expect(response.status).toBe(401);
  });
});
