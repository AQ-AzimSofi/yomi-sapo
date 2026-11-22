import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { withClients } from '@/lib/db/sync-core';
import { GET, POST } from './route';

vi.mock('@/lib/db/sync-core', () => ({
  computeDiffs: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  fullSync: vi.fn(),
  withClients: vi.fn(),
}));

const SYNC_URL = 'http://localhost/api/db-sync';
const OWNER_HEADERS = await ownerSessionHeaders();

function syncRequest(body: unknown): Request {
  return new Request(SYNC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...OWNER_HEADERS },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('PROD_DATABASE_URL', 'postgresql://prod.invalid/yomi_sapo');
  vi.stubEnv('DATABASE_URL', 'postgresql://local.invalid/yomi_sapo');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/db-sync', () => {
  it('rejects a guest without opening either database', async () => {
    const response = await GET(new Request(SYNC_URL));

    expect(response.status).toBe(401);
    expect(withClients).not.toHaveBeenCalled();
  });

  it('returns the diffs to the signed-in owner', async () => {
    vi.mocked(withClients).mockResolvedValue([]);

    const response = await GET(new Request(SYNC_URL, { headers: OWNER_HEADERS }));

    expect(await response.json()).toStrictEqual({ diffs: [] });
  });

  it('answers 503 with a message the sync modal shows when production is not configured', async () => {
    vi.stubEnv('PROD_DATABASE_URL', '');

    const response = await GET(new Request(SYNC_URL, { headers: OWNER_HEADERS }));

    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toBe('Sync not available - PROD_DSQL_ENDPOINT or PROD_DATABASE_URL not configured');
    expect(withClients).not.toHaveBeenCalled();
  });

  it('syncs with Neon through PROD_DATABASE_URL', async () => {
    vi.mocked(withClients).mockResolvedValue([]);

    await GET(new Request(SYNC_URL, { headers: OWNER_HEADERS }));

    expect(withClients).toHaveBeenCalledWith(
      { kind: 'postgres', url: 'postgresql://prod.invalid/yomi_sapo' },
      'postgresql://local.invalid/yomi_sapo',
      expect.any(Function)
    );
  });

  it('syncs with Aurora DSQL once PROD_DSQL_ENDPOINT is set', async () => {
    vi.stubEnv('PROD_DSQL_ENDPOINT', 'abc123.dsql.ap-northeast-1.on.aws');
    vi.mocked(withClients).mockResolvedValue([]);

    await GET(new Request(SYNC_URL, { headers: OWNER_HEADERS }));

    expect(vi.mocked(withClients).mock.calls[0][0]).toEqual({
      kind: 'dsql',
      settings: { endpoint: 'abc123.dsql.ap-northeast-1.on.aws', region: 'ap-northeast-1', user: 'admin' },
    });
  });

  it('answers a generic 500 that does not leak the connection error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(withClients).mockRejectedValue(new Error('password authentication failed for user "neondb_owner"'));

    const response = await GET(new Request(SYNC_URL, { headers: OWNER_HEADERS }));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('neondb_owner');
    error.mockRestore();
  });
});

describe('POST /api/db-sync', () => {
  it('rejects a guest without opening either database', async () => {
    const response = await POST(
      new Request(SYNC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'push' }),
      })
    );

    expect(response.status).toBe(401);
    expect(withClients).not.toHaveBeenCalled();
  });

  it.each([{ direction: 'sideways' }, {}, ['pull']])('answers 400 without syncing for %j', async (body) => {
    const response = await POST(syncRequest(body));

    expect(response.status).toBe(400);
    expect(withClients).not.toHaveBeenCalled();
  });

  it('runs the sync in the requested direction', async () => {
    vi.mocked(withClients).mockResolvedValue([]);

    const response = await POST(syncRequest({ direction: 'pull' }));

    expect(await response.json()).toStrictEqual({ success: true, results: [] });
    expect(withClients).toHaveBeenCalledOnce();
  });
});
