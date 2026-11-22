import 'server-only';
import postgres from 'postgres';
import { POSTGRES_URL_OPTIONS, readDatabaseUrl } from './connectionConfig';

const connectionString = readDatabaseUrl(process.env);

if (!connectionString) {
  console.warn('Warning: No DATABASE_URL or POSTGRES_URL found. Database queries will fail.');
  console.warn('Please create .env.local from .env.local.example and configure DATABASE_URL');
}

// postgres.js opens connections on the first query, so importing this module connects nothing.
export const sql: postgres.Sql = postgres(connectionString, POSTGRES_URL_OPTIONS);
