import type { ClientConfig } from 'pg';
import {
  DSQL_ADMIN_USER,
  iamTokenSource,
  regionOfDsqlEndpoint,
  type ConnectionEnv,
  type DsqlSettings,
} from './connectionConfig';

/**
 * The production database as the local tools reach it from a developer's machine (the dev sync,
 * clean-book-text --prod). Aurora DSQL when PROD_DSQL_ENDPOINT is set in .env.local; otherwise
 * PROD_DATABASE_URL (Neon), as before.
 */
export type ProdDatabase = { kind: 'dsql'; settings: DsqlSettings } | { kind: 'postgres'; url: string };

export const PROD_DATABASE_VARIABLES = 'PROD_DSQL_ENDPOINT or PROD_DATABASE_URL';

function readProdDsqlSettings(endpoint: string, user: string | undefined): DsqlSettings {
  const region = regionOfDsqlEndpoint(endpoint);
  if (!region) throw new Error(`PROD_DSQL_ENDPOINT is not an Aurora DSQL endpoint (<cluster id>.dsql.<region>.on.aws): ${endpoint}`);
  return { endpoint, region, user: user || DSQL_ADMIN_USER };
}

/** The production database the env names, or null when it names none. */
export function readProdDatabase(env: ConnectionEnv): ProdDatabase | null {
  const endpoint = env.PROD_DSQL_ENDPOINT;
  if (endpoint) return { kind: 'dsql', settings: readProdDsqlSettings(endpoint, env.PROD_DSQL_USER) };
  if (env.PROD_DATABASE_URL) return { kind: 'postgres', url: env.PROD_DATABASE_URL };
  return null;
}

/**
 * pg settings for the production database. On DSQL, pg asks for the password on each connect, and
 * gets a fresh IAM token signed with the local AWS profile: an admin token for admin (the default
 * PROD_DSQL_USER), a role token for any other user. The certificate and host name are checked.
 */
export function prodClientConfig(prod: ProdDatabase): ClientConfig {
  if (prod.kind === 'postgres') return { connectionString: prod.url, ssl: { rejectUnauthorized: false } };
  return {
    host: prod.settings.endpoint,
    port: 5432,
    database: 'postgres',
    user: prod.settings.user,
    password: iamTokenSource(prod.settings),
    ssl: { rejectUnauthorized: true },
  };
}

export function prodHostOf(prod: ProdDatabase): string {
  return prod.kind === 'dsql' ? prod.settings.endpoint : new URL(prod.url).hostname;
}
