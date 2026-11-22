import { DsqlSigner } from '@aws-sdk/dsql-signer';

export type ConnectionEnv = Readonly<Record<string, string | undefined>>;

export type DatabaseKind = 'postgres' | 'dsql';

export const POSTGRES_URL_OPTIONS = {
  max: 3,
  idle_timeout: 5,
  connect_timeout: 10,
  max_lifetime: 60 * 2,
};

export const DEFAULT_DSQL_USER = 'yomi_app';
export const DSQL_ADMIN_USER = 'admin';

const DSQL_ENDPOINT = /^[a-z0-9]+\.dsql\.([a-z0-9-]+)\.on\.aws$/;

export interface DsqlSettings {
  endpoint: string;
  user: string;
  region: string;
}

export type TokenSource = () => Promise<string>;

export function readDatabaseUrl(env: ConnectionEnv): string {
  return env.DATABASE_URL || env.POSTGRES_URL || '';
}

/** The region of an Aurora DSQL cluster endpoint, or null for anything that is not one. */
export function regionOfDsqlEndpoint(endpoint: string): string | null {
  return DSQL_ENDPOINT.exec(endpoint)?.[1] ?? null;
}

/** The Aurora DSQL cluster to connect to, or null when DSQL_ENDPOINT is not set. */
export function readDsqlSettings(env: ConnectionEnv): DsqlSettings | null {
  const endpoint = env.DSQL_ENDPOINT;
  if (!endpoint) return null;
  const region = env.DSQL_REGION || env.AWS_REGION;
  if (!region) throw new Error('DSQL_ENDPOINT is set, but neither DSQL_REGION nor AWS_REGION names its region');
  return { endpoint, user: env.DSQL_USER || DEFAULT_DSQL_USER, region };
}

/** IAM auth tokens for the user: DSQL accepts only an admin token for admin and only a role token for any other user. */
export function iamTokenSource(settings: DsqlSettings): TokenSource {
  const signer = new DsqlSigner({ hostname: settings.endpoint, region: settings.region });
  if (settings.user === DSQL_ADMIN_USER) return () => signer.getDbConnectAdminAuthToken();
  return () => signer.getDbConnectAuthToken();
}

// postgres.js calls password for each new connection, so a token is minted only when one opens.
// Opening one costs the token, TLS and IAM auth (about 280 ms from Tokyo), so idle connections
// stay a minute. DSQL ends every connection at 60 minutes; the pool replaces them at 30.
export function buildDsqlOptions(settings: DsqlSettings, password: TokenSource) {
  return {
    host: settings.endpoint,
    port: 5432,
    database: 'postgres',
    username: settings.user,
    password,
    ssl: 'verify-full' as const,
    max: 3,
    idle_timeout: 60,
    max_lifetime: 30 * 60,
    connect_timeout: 10,
  };
}
