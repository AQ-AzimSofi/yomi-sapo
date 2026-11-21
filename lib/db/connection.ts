import 'server-only';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

if (!connectionString) {
  console.warn('Warning: No DATABASE_URL or POSTGRES_URL found. Database queries will fail.');
  console.warn('Please create .env.local from .env.local.example and configure DATABASE_URL');
}

// postgres.js opens connections on the first query, so importing this module connects nothing.
export const sql: postgres.Sql = postgres(connectionString, {
  max: 3,
  idle_timeout: 5,
  connect_timeout: 10,
  max_lifetime: 60 * 2,
});
