import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { iamTokenSource } from '../../lib/db/connectionConfig';
import { applySchema } from '../../lib/db/schemaRunner';
import { main, parseApplySchemaArgs } from './apply-schema-dsql';

vi.mock('postgres', () => ({ default: vi.fn() }));
vi.mock('../../lib/db/schemaRunner', () => ({ applySchema: vi.fn() }));
vi.mock('../../lib/db/connectionConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db/connectionConfig')>()),
  iamTokenSource: vi.fn(() => () => Promise.resolve('admin-token')),
}));

const ENDPOINT = 'abc123.dsql.ap-northeast-1.on.aws';

function fakeClient() {
  const client = { end: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(postgres).mockReturnValue(client as never);
  return client;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(applySchema).mockReset();
});

describe('parseApplySchemaArgs', () => {
  it('reads the cluster endpoint and its region, as admin', () => {
    expect(parseApplySchemaArgs(['--endpoint', ENDPOINT])).toEqual({ endpoint: ENDPOINT, region: 'ap-northeast-1', user: 'admin' });
  });

  it.each([
    [[]],
    [['--endpoint']],
    [['--endpoint', 'ep-example.ap-southeast-1.aws.neon.tech']],
    [['--endpoint', 'localhost']],
    [['--endpoint', ENDPOINT, '--force']],
    [[ENDPOINT]],
  ])('refuses %j', (args) => {
    expect(() => parseApplySchemaArgs(args)).toThrow(/usage/);
  });
});

describe('main', () => {
  it('applies the DSQL schema as admin over TLS with a token per connection', async () => {
    const client = fakeClient();

    await main(['--endpoint', ENDPOINT]);

    expect(iamTokenSource).toHaveBeenCalledWith({ endpoint: ENDPOINT, region: 'ap-northeast-1', user: 'admin' });
    expect(postgres).toHaveBeenCalledWith(expect.objectContaining({ host: ENDPOINT, username: 'admin', ssl: 'verify-full', max: 1 }));
    expect(applySchema).toHaveBeenCalledWith(client, 'dsql', expect.any(Function));
    expect(client.end).toHaveBeenCalled();
  });

  it('closes the connection when a statement fails', async () => {
    const client = fakeClient();
    vi.mocked(applySchema).mockRejectedValue(new Error('permission denied'));

    await expect(main(['--endpoint', ENDPOINT])).rejects.toThrow('permission denied');
    expect(client.end).toHaveBeenCalled();
  });

  it('connects to nothing when the arguments are wrong', async () => {
    await expect(main(['--endpoint', 'localhost'])).rejects.toThrow(/usage/);
    expect(postgres).not.toHaveBeenCalled();
  });
});
