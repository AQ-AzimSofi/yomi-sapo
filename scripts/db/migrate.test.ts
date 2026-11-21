import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_TABLES_SQL, MIGRATIONS_SQL } from '../../lib/db/schema';

vi.mock('fs', () => ({ readFileSync: vi.fn() }));
vi.mock('postgres', () => ({ default: vi.fn() }));

// migrate.ts runs on import, so each case loads a fresh copy against its own fake client.
async function startMigrate(databaseUrl: string, hosts: string[]) {
  vi.resetModules();
  const fs = await import('fs');
  const { default: postgres } = await import('postgres');
  const client = { options: { host: hosts }, unsafe: vi.fn().mockResolvedValue([]), end: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(fs.readFileSync).mockReturnValue(`DATABASE_URL=${databaseUrl}\n`);
  vi.mocked(postgres).mockReturnValue(client as never);
  await import('./migrate');
  return client;
}

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrate', () => {
  it('refuses a host list that includes a remote host before running any SQL', async () => {
    const client = await startMigrate('postgres://postgres:123@localhost,ep-x.neon.tech/yomi_sapo', ['localhost', 'ep-x.neon.tech']);

    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(client.unsafe).not.toHaveBeenCalled();
  });

  it('applies the schema SQL to a local database', async () => {
    const client = await startMigrate('postgres://postgres:123@localhost:5433/yomi_sapo', ['localhost']);

    await vi.waitFor(() => expect(client.end).toHaveBeenCalled());
    expect(client.unsafe.mock.calls).toEqual([[CREATE_TABLES_SQL], [MIGRATIONS_SQL]]);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
