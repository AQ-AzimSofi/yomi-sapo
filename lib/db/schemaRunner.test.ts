import { describe, expect, it, vi } from 'vitest';
import { schemaStatementsFor } from './schema';
import { applySchema, type SchemaClient } from './schemaRunner';

const WAIT_FOR_JOB = 'CALL sys.wait_for_job($1)';

function fakeClient(answer: (statement: string) => unknown[] = () => []) {
  const unsafe = vi.fn((statement: string) => Promise.resolve(answer(statement)));
  return { client: { unsafe } as unknown as SchemaClient, unsafe };
}

function statementsSent(unsafe: ReturnType<typeof fakeClient>['unsafe']): string[] {
  return unsafe.mock.calls.map(([statement]) => statement);
}

function isIndexStatement(statement: string): boolean {
  return statement.startsWith('CREATE INDEX');
}

describe('schemaStatementsFor', () => {
  it.each(['postgres', 'dsql'] as const)('holds one statement per entry for %s', (kind) => {
    expect(schemaStatementsFor(kind).filter((statement) => statement.includes(';'))).toEqual([]);
  });

  it.each(['postgres', 'dsql'] as const)('creates only what does not exist yet, for %s', (kind) => {
    const creates = schemaStatementsFor(kind).filter((statement) => statement.startsWith('CREATE'));
    expect(creates.filter((statement) => !statement.includes('IF NOT EXISTS'))).toEqual([]);
  });

  it('gives new tables INT ids from CACHE 1 sequences, never SERIAL', () => {
    const statements = schemaStatementsFor('dsql');
    expect(statements.filter((statement) => /SERIAL/i.test(statement))).toEqual([]);
    expect(statements.filter((statement) => /^CREATE SEQUENCE/.test(statement)).every((statement) => statement.endsWith('CACHE 1'))).toBe(true);
  });

  it('builds every secondary index as CREATE INDEX ASYNC, the only form DSQL accepts', () => {
    expect(schemaStatementsFor('dsql').filter(isIndexStatement).every((statement) => statement.startsWith('CREATE INDEX ASYNC IF NOT EXISTS'))).toBe(true);
  });

  it('sends DSQL no DML and no ADD COLUMN with a DEFAULT, which it refuses', () => {
    const refused = schemaStatementsFor('dsql').filter((statement) => /^(UPDATE|INSERT|DELETE)\b/.test(statement) || /ADD COLUMN[\s\S]*DEFAULT/.test(statement));
    expect(refused).toEqual([]);
  });

  it('still upgrades tables an older schema created on PostgreSQL', () => {
    expect(schemaStatementsFor('postgres')).toEqual(expect.arrayContaining([
      'ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS content_bytes INT',
      'UPDATE text_entries SET updated_at = created_at WHERE updated_at IS NULL',
    ]));
  });

  it('creates the tables before any upgrade or index that refers to their columns', () => {
    const statements = schemaStatementsFor('postgres');
    const lastTable = statements.findLastIndex((statement) => statement.startsWith('CREATE TABLE'));
    const firstOther = statements.findIndex((statement) => statement.startsWith('ALTER') || isIndexStatement(statement));
    const lastUpgrade = statements.findLastIndex((statement) => !statement.startsWith('CREATE'));
    const firstIndex = statements.findIndex(isIndexStatement);
    expect(lastTable).toBeLessThan(firstOther);
    expect(lastUpgrade).toBeLessThan(firstIndex);
  });
});

describe('applySchema on PostgreSQL', () => {
  it('runs each statement in its own call, in order, with ASYNC removed', async () => {
    const { client, unsafe } = fakeClient();

    await applySchema(client, 'postgres');

    const sent = statementsSent(unsafe);
    expect(sent).toHaveLength(schemaStatementsFor('postgres').length);
    expect(sent.filter((statement) => statement.includes('ASYNC'))).toEqual([]);
    expect(sent.filter(isIndexStatement).every((statement) => statement.startsWith('CREATE INDEX IF NOT EXISTS'))).toBe(true);
  });

  it('sends each statement without parameters, so postgres.js uses the simple query protocol', async () => {
    const { client, unsafe } = fakeClient();

    await applySchema(client, 'postgres');

    expect(unsafe.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it('stops at the first statement that fails', async () => {
    const { client, unsafe } = fakeClient();
    unsafe.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('permission denied'));

    await expect(applySchema(client, 'postgres')).rejects.toThrow('permission denied');
    expect(unsafe).toHaveBeenCalledTimes(2);
  });
});

describe('applySchema on Aurora DSQL', () => {
  it('waits for the job that builds each new index before the next statement', async () => {
    const { client, unsafe } = fakeClient((statement) => {
      if (statement === WAIT_FOR_JOB) return [{ succeeded: true }];
      return isIndexStatement(statement) ? [{ job_id: `job-${statement.length}` }] : [];
    });

    await applySchema(client, 'dsql');

    const sent = statementsSent(unsafe);
    const indexes = schemaStatementsFor('dsql').filter(isIndexStatement);
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(sent[sent.indexOf(index) + 1]).toBe(WAIT_FOR_JOB);
      expect(unsafe).toHaveBeenCalledWith(WAIT_FOR_JOB, [`job-${index.length}`]);
    }
  });

  it('sends the statements unchanged and skips the wait for an index that already exists', async () => {
    const { client, unsafe } = fakeClient();

    await applySchema(client, 'dsql');

    expect(statementsSent(unsafe).slice(0, schemaStatementsFor('dsql').length)).toEqual(schemaStatementsFor('dsql'));
    expect(statementsSent(unsafe)).not.toContain(WAIT_FOR_JOB);
  });

  // A failed build leaves its index behind, invalid, and IF NOT EXISTS then skips it without a job.
  it('fails while an index that a failed build left behind is invalid', async () => {
    const { client } = fakeClient((statement) => (statement.includes('indisvalid') ? [{ index_name: 'idx_text_entries_library' }] : []));

    await expect(applySchema(client, 'dsql')).rejects.toThrow(/idx_text_entries_library/);
  });

  it('fails when a job reports that the index was not built', async () => {
    const { client } = fakeClient((statement) => {
      if (statement === WAIT_FOR_JOB) return [{ succeeded: false }];
      return isIndexStatement(statement) ? [{ job_id: 'job-1' }] : [];
    });

    await expect(applySchema(client, 'dsql')).rejects.toThrow(/job-1/);
  });

  it('reports each statement it applied', async () => {
    const { client } = fakeClient();
    const log = vi.fn();

    await applySchema(client, 'dsql', log);

    expect(log).toHaveBeenCalledTimes(schemaStatementsFor('dsql').length);
  });
});
