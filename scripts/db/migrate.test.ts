import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_STATEMENTS } from '../../lib/db/schema';
import { main } from './migrate';

vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs')>()), readFileSync: vi.fn() }));
vi.mock('postgres', () => ({ default: vi.fn() }));

async function createFakeClient(databaseUrl: string, hosts: string[]) {
  const fs = await import('fs');
  const { default: postgres } = await import('postgres');
  const client = { options: { host: hosts }, unsafe: vi.fn().mockResolvedValue([]), end: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(fs.readFileSync).mockReturnValue(`DATABASE_URL=${databaseUrl}\n`);
  vi.mocked(postgres).mockReturnValue(client as never);
  return client;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrate', () => {
  it('refuses a host list that includes a remote host before running any SQL', async () => {
    const client = await createFakeClient('postgres://postgres:123@localhost,ep-x.neon.tech/yomi_sapo', ['localhost', 'ep-x.neon.tech']);

    await expect(main()).rejects.toThrow(/refusing/);
    expect(client.unsafe).not.toHaveBeenCalled();
  });

  it('applies the schema SQL to a local database', async () => {
    const client = await createFakeClient('postgres://postgres:123@localhost:5433/yomi_sapo', ['localhost']);

    await main();
    expect(client.unsafe.mock.calls).toEqual(SCHEMA_STATEMENTS.map((statement) => [statement]));
    expect(client.end).toHaveBeenCalled();
  });
});
