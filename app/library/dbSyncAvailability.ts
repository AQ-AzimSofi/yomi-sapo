// The sync needs PROD_DATABASE_URL, which only a developer's .env.local holds;
// the deployed app never has it, so the button could only ever fail there.
export const IS_DB_SYNC_AVAILABLE = process.env.NODE_ENV === 'development';
