import { describe, expect, it, vi } from 'vitest';
import { SCHEMA_STATEMENTS } from './schema';
import { applySchema, type SchemaClient } from './schemaRunner';

function fakeClient() {
  const unsafe = vi.fn().mockResolvedValue([]);
  return { client: { unsafe } as unknown as SchemaClient, unsafe };
}

describe('SCHEMA_STATEMENTS', () => {
  it('holds one statement per entry', () => {
    expect(SCHEMA_STATEMENTS.filter((statement) => statement.trim().replace(/;$/, '').includes(';'))).toEqual([]);
  });
});

describe('applySchema', () => {
  it('runs each statement in its own call, in order', async () => {
    const { client, unsafe } = fakeClient();

    await applySchema(client);

    expect(unsafe.mock.calls).toEqual(SCHEMA_STATEMENTS.map((statement) => [statement]));
  });

  it('stops at the first statement that fails', async () => {
    const { client, unsafe } = fakeClient();
    unsafe.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('permission denied'));

    await expect(applySchema(client)).rejects.toThrow('permission denied');
    expect(unsafe).toHaveBeenCalledTimes(2);
  });
});
