import { afterEach, describe, expect, it, vi } from 'vitest';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import {
  buildDsqlOptions,
  iamTokenSource,
  readDatabaseUrl,
  readDsqlSettings,
  regionOfDsqlEndpoint,
  type DsqlSettings,
} from './connectionConfig';

vi.mock('@aws-sdk/dsql-signer', () => ({
  DsqlSigner: vi.fn(() => ({
    getDbConnectAuthToken: vi.fn().mockResolvedValue('app-token'),
    getDbConnectAdminAuthToken: vi.fn().mockResolvedValue('admin-token'),
  })),
}));

const ENDPOINT = 'abc123.dsql.ap-northeast-1.on.aws';
const APP_SETTINGS: DsqlSettings = { endpoint: ENDPOINT, user: 'yomi_app', region: 'ap-northeast-1' };

afterEach(() => {
  vi.mocked(DsqlSigner).mockClear();
});

describe('readDatabaseUrl', () => {
  it('prefers DATABASE_URL over POSTGRES_URL', () => {
    expect(readDatabaseUrl({ DATABASE_URL: 'postgres://a', POSTGRES_URL: 'postgres://b' })).toBe('postgres://a');
  });

  it('is empty when neither is set', () => {
    expect(readDatabaseUrl({})).toBe('');
  });
});

describe('regionOfDsqlEndpoint', () => {
  it('reads the region from a cluster endpoint', () => {
    expect(regionOfDsqlEndpoint(ENDPOINT)).toBe('ap-northeast-1');
  });

  it.each(['ep-example.ap-southeast-1.aws.neon.tech', 'localhost', `${ENDPOINT}.evil.example`, ''])('is null for %j', (host) => {
    expect(regionOfDsqlEndpoint(host)).toBeNull();
  });
});

describe('readDsqlSettings', () => {
  it('is null without DSQL_ENDPOINT, whatever else is set', () => {
    expect(readDsqlSettings({ DATABASE_URL: 'postgres://a', DSQL_USER: 'admin', DSQL_REGION: 'ap-northeast-1' })).toBeNull();
  });

  it('is null for an empty DSQL_ENDPOINT', () => {
    expect(readDsqlSettings({ DSQL_ENDPOINT: '', DSQL_REGION: 'ap-northeast-1' })).toBeNull();
  });

  it('defaults the user to yomi_app', () => {
    expect(readDsqlSettings({ DSQL_ENDPOINT: ENDPOINT, DSQL_REGION: 'ap-northeast-1' })).toEqual(APP_SETTINGS);
  });

  it('takes DSQL_USER', () => {
    expect(readDsqlSettings({ DSQL_ENDPOINT: ENDPOINT, DSQL_USER: 'admin', DSQL_REGION: 'ap-northeast-1' })?.user).toBe('admin');
  });

  it('falls back to the AWS_REGION Lambda sets', () => {
    expect(readDsqlSettings({ DSQL_ENDPOINT: ENDPOINT, AWS_REGION: 'us-east-1' })?.region).toBe('us-east-1');
  });

  it('refuses an endpoint without a region', () => {
    expect(() => readDsqlSettings({ DSQL_ENDPOINT: ENDPOINT })).toThrow(/region/);
  });
});

describe('buildDsqlOptions', () => {
  const password = () => Promise.resolve('token');

  it('connects with TLS certificate checks and a pool that keeps connections warm', () => {
    expect(buildDsqlOptions(APP_SETTINGS, password)).toEqual({
      host: ENDPOINT,
      port: 5432,
      database: 'postgres',
      username: 'yomi_app',
      password,
      ssl: 'verify-full',
      max: 3,
      idle_timeout: 60,
      max_lifetime: 30 * 60,
      connect_timeout: 10,
    });
  });
});

describe('iamTokenSource', () => {
  it('signs for the cluster endpoint and region', () => {
    iamTokenSource(APP_SETTINGS);

    expect(DsqlSigner).toHaveBeenCalledWith({ hostname: ENDPOINT, region: 'ap-northeast-1' });
  });

  it('mints a database role token for the app user', async () => {
    await expect(iamTokenSource(APP_SETTINGS)()).resolves.toBe('app-token');
  });

  it('mints an admin token for the admin user', async () => {
    await expect(iamTokenSource({ ...APP_SETTINGS, user: 'admin' })()).resolves.toBe('admin-token');
  });
});
