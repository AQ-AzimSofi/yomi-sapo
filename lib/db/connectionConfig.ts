export type ConnectionEnv = Readonly<Record<string, string | undefined>>;

export const POSTGRES_URL_OPTIONS = {
  max: 3,
  idle_timeout: 5,
  connect_timeout: 10,
  max_lifetime: 60 * 2,
};

export function readDatabaseUrl(env: ConnectionEnv): string {
  return env.DATABASE_URL || env.POSTGRES_URL || '';
}
