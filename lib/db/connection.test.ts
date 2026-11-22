import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';

vi.mock('postgres', () => ({ default: vi.fn(() => ({})) }));

const CONNECTION_ENV = ['DATABASE_URL', 'POSTGRES_URL', 'DSQL_ENDPOINT', 'DSQL_USER', 'DSQL_REGION', 'AWS_REGION'];

async function importConnectionWith(env: Record<string, string>): Promise<typeof import('./connection')> {
  for (const name of CONNECTION_ENV) vi.stubEnv(name, env[name]);
  vi.resetModules();
  return import('./connection');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(postgres).mockClear();
});

describe('connection without DSQL_ENDPOINT', () => {
  it('connects to DATABASE_URL with the pool options it has always used', async () => {
    await importConnectionWith({ DATABASE_URL: 'postgres://u:p@db.example/app', POSTGRES_URL: 'postgres://other/app' });

    expect(vi.mocked(postgres).mock.calls).toEqual([
      ['postgres://u:p@db.example/app', { max: 3, idle_timeout: 5, connect_timeout: 10, max_lifetime: 120 }],
    ]);
  });

  it('falls back to POSTGRES_URL', async () => {
    await importConnectionWith({ POSTGRES_URL: 'postgres://other/app' });

    expect(vi.mocked(postgres).mock.calls[0][0]).toBe('postgres://other/app');
  });

  it('warns and passes an empty connection string when no URL is set', async () => {
    await importConnectionWith({});

    expect(vi.mocked(postgres).mock.calls[0][0]).toBe('');
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('reports a PostgreSQL database', async () => {
    const connection = await importConnectionWith({ DATABASE_URL: 'postgres://u:p@db.example/app' });

    expect(connection.databaseKind).toBe('postgres');
  });
});

describe('connection with DSQL_ENDPOINT', () => {
  const DSQL_ENV = { DSQL_ENDPOINT: 'abc123.dsql.ap-northeast-1.on.aws', DSQL_REGION: 'ap-northeast-1', DATABASE_URL: 'postgres://neon/app' };

  it('connects to the cluster with the DSQL options instead of DATABASE_URL', async () => {
    const connection = await importConnectionWith(DSQL_ENV);

    expect(vi.mocked(postgres).mock.calls).toEqual([[expect.objectContaining({ host: DSQL_ENV.DSQL_ENDPOINT, username: 'yomi_app', ssl: 'verify-full' })]]);
    expect(connection.databaseKind).toBe('dsql');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('asks for a password function, so every new connection gets a fresh token', async () => {
    await importConnectionWith(DSQL_ENV);

    const [options] = vi.mocked(postgres).mock.calls[0] as unknown as [{ password: unknown }];
    expect(options.password).toBeTypeOf('function');
  });
});
