#!/usr/bin/env npx tsx
/**
 * Applies the schema in lib/db/schema.ts to an Aurora DSQL cluster as admin: one statement per
 * transaction, waiting for each CREATE INDEX ASYNC job to finish. The app's database role may
 * not run DDL, so this is how a DSQL schema is created or changed; GET /api/init-db refuses.
 *
 * It signs an admin IAM token with the default AWS credentials (the local profile), which need
 * dsql:DbConnectAdmin on the cluster. Every statement is IF NOT EXISTS, so running it again
 * changes nothing. Change the schema only while the app serves no traffic: after a DDL
 * statement, the next statement of an app session can fail once with OC001.
 *
 * Usage:
 *   npx tsx scripts/db/apply-schema-dsql.ts --endpoint <cluster id>.dsql.<region>.on.aws
 */

import postgres from 'postgres';
import {
  buildDsqlOptions,
  DSQL_ADMIN_USER,
  iamTokenSource,
  regionOfDsqlEndpoint,
  type DsqlSettings,
} from '../../lib/db/connectionConfig';
import { applySchema } from '../../lib/db/schemaRunner';
import { isEntryPoint } from '../shared/entryPoint';

const USAGE = 'usage: npx tsx scripts/db/apply-schema-dsql.ts --endpoint <cluster id>.dsql.<region>.on.aws';

// Anything but an explicit DSQL endpoint is refused, so a typo never reaches another database.
export function parseApplySchemaArgs(args: readonly string[]): DsqlSettings {
  const [flag, endpoint = '', ...rest] = args;
  const region = regionOfDsqlEndpoint(endpoint);
  if (flag !== '--endpoint' || !region || rest.length > 0) throw new Error(USAGE);
  return { endpoint, region, user: DSQL_ADMIN_USER };
}

export async function main(args: readonly string[]): Promise<void> {
  const settings = parseApplySchemaArgs(args);
  const sql = postgres({ ...buildDsqlOptions(settings, iamTokenSource(settings)), max: 1, onnotice: () => undefined });
  try {
    console.log(`Target cluster: ${settings.endpoint}`);
    await applySchema(sql, 'dsql', (line) => console.log(`applied: ${line}`));
    console.log('Schema is up to date.');
  } finally {
    await sql.end();
  }
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('apply-schema-dsql failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
