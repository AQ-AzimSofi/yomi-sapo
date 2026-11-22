import 'server-only';
import postgres from 'postgres';
import {
  buildDsqlOptions,
  iamTokenSource,
  POSTGRES_URL_OPTIONS,
  readDatabaseUrl,
  readDsqlSettings,
  type DatabaseKind,
} from './connectionConfig';

// Aurora DSQL only when DSQL_ENDPOINT is set; otherwise DATABASE_URL, as before.
const dsqlSettings = readDsqlSettings(process.env);

export const databaseKind: DatabaseKind = dsqlSettings ? 'dsql' : 'postgres';

function connectToDatabaseUrl(): postgres.Sql {
  const connectionString = readDatabaseUrl(process.env);

  if (!connectionString) {
    console.warn('Warning: No DATABASE_URL or POSTGRES_URL found. Database queries will fail.');
    console.warn('Please create .env.local from .env.local.example and configure DATABASE_URL');
  }

  return postgres(connectionString, POSTGRES_URL_OPTIONS);
}

// postgres.js opens connections on the first query, so importing this module connects nothing.
export const sql: postgres.Sql = dsqlSettings
  ? postgres(buildDsqlOptions(dsqlSettings, iamTokenSource(dsqlSettings)))
  : connectToDatabaseUrl();
