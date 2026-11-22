import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySchema } from '../../lib/db/schemaRunner';
import { main } from './migrate';

vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs')>()), readFileSync: vi.fn() }));
vi.mock('postgres', () => ({ default: vi.fn() }));
vi.mock('../../lib/db/schemaRunner', () => ({ applySchema: vi.fn() }));

async function createFakeClient(databaseUrl: string, hosts: string[]) {
  const fs = await import('fs');
  const { default: postgres } = await import('postgres');
  const client = { options: { host: hosts }, end: vi.fn().mockResolvedValue(undefined) };
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
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('applies the PostgreSQL schema to a local database', async () => {
    const client = await createFakeClient('postgres://postgres:123@localhost:5433/yomi_sapo', ['localhost']);

    await main();
    expect(applySchema).toHaveBeenCalledWith(client, 'postgres');
    expect(client.end).toHaveBeenCalled();
  });
});
