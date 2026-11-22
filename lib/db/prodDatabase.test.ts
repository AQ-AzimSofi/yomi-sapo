import { describe, expect, it, vi } from 'vitest';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { prodClientConfig, prodHostOf, readProdDatabase, type ProdDatabase } from './prodDatabase';

vi.mock('@aws-sdk/dsql-signer', () => ({
  DsqlSigner: vi.fn(() => ({
    getDbConnectAuthToken: vi.fn().mockResolvedValue('app-token'),
    getDbConnectAdminAuthToken: vi.fn().mockResolvedValue('admin-token'),
  })),
}));

const ENDPOINT = 'abc123.dsql.ap-northeast-1.on.aws';
const NEON_URL = 'postgresql://owner:secret@ep-example.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const DSQL_ADMIN: ProdDatabase = { kind: 'dsql', settings: { endpoint: ENDPOINT, region: 'ap-northeast-1', user: 'admin' } };

describe('readProdDatabase', () => {
  it('is null when neither variable is set', () => {
    expect(readProdDatabase({ DATABASE_URL: 'postgresql://localhost/yomi_sapo' })).toBeNull();
  });

  it('keeps PROD_DATABASE_URL when no DSQL endpoint is set', () => {
    expect(readProdDatabase({ PROD_DATABASE_URL: NEON_URL })).toEqual({ kind: 'postgres', url: NEON_URL });
  });

  it('prefers the DSQL endpoint, as admin, in the region the endpoint names', () => {
    expect(readProdDatabase({ PROD_DSQL_ENDPOINT: ENDPOINT, PROD_DATABASE_URL: NEON_URL })).toEqual(DSQL_ADMIN);
  });

  it('takes PROD_DSQL_USER', () => {
    const prod = readProdDatabase({ PROD_DSQL_ENDPOINT: ENDPOINT, PROD_DSQL_USER: 'yomi_app' });

    expect(prod).toEqual({ kind: 'dsql', settings: { endpoint: ENDPOINT, region: 'ap-northeast-1', user: 'yomi_app' } });
  });

  it('refuses an endpoint that is not a DSQL cluster', () => {
    expect(() => readProdDatabase({ PROD_DSQL_ENDPOINT: 'ep-example.ap-southeast-1.aws.neon.tech' })).toThrow(/not an Aurora DSQL endpoint/);
  });
});

describe('prodClientConfig', () => {
  it('connects to Neon with the same settings as before', () => {
    expect(prodClientConfig({ kind: 'postgres', url: NEON_URL })).toEqual({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
  });

  it('connects to DSQL over a checked TLS connection with a fresh admin token per connection', async () => {
    const config = prodClientConfig(DSQL_ADMIN);

    expect(config).toEqual({
      host: ENDPOINT,
      port: 5432,
      database: 'postgres',
      user: 'admin',
      password: expect.any(Function),
      ssl: { rejectUnauthorized: true },
    });
    expect(DsqlSigner).toHaveBeenCalledWith({ hostname: ENDPOINT, region: 'ap-northeast-1' });
    expect(await (config.password as () => Promise<string>)()).toBe('admin-token');
  });
});

describe('prodHostOf', () => {
  it('names the Neon host without the credentials', () => {
    expect(prodHostOf({ kind: 'postgres', url: NEON_URL })).toBe('ep-example.ap-southeast-1.aws.neon.tech');
  });

  it('names the DSQL endpoint', () => {
    expect(prodHostOf(DSQL_ADMIN)).toBe(ENDPOINT);
  });
});
