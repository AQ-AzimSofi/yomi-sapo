#!/usr/bin/env npx tsx
/**
 * Brings the local database to the current schema by running CREATE_TABLES_SQL and
 * MIGRATIONS_SQL from lib/db/schema.ts, the same SQL GET /api/init-db runs.
 *
 * It reads DATABASE_URL from .env.local and refuses any host other than localhost or
 * 127.0.0.1: production schema changes stay a deliberate manual step.
 *
 * Usage:
 *   npm run db:migrate
 */

import * as fs from 'fs';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { CREATE_TABLES_SQL, MIGRATIONS_SQL } from '../../lib/db/schema';
import { isLocalDatabase } from './localDatabase';

const ENV_FILE = '.env.local';

function readDatabaseUrl(): string {
  const env = dotenv.parse(fs.readFileSync(ENV_FILE));
  if (!env.DATABASE_URL) throw new Error(`No DATABASE_URL in ${ENV_FILE}`);
  return env.DATABASE_URL;
}

async function main(): Promise<void> {
  // IF NOT EXISTS reports every table that is already there as a notice.
  const sql = postgres(readDatabaseUrl(), { max: 1, onnotice: () => undefined });
  try {
    // The hosts postgres.js will connect to, including a PGHOST fallback for a URL without one.
    const hosts = sql.options.host;
    console.log(`Target host: ${hosts.join(', ')}`);
    if (!isLocalDatabase(hosts)) {
      throw new Error('refusing to change a database that is not on localhost or 127.0.0.1');
    }

    await sql.unsafe(CREATE_TABLES_SQL);
    await sql.unsafe(MIGRATIONS_SQL);
    console.log('Schema is up to date.');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('migrate failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
