import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from './connection';
import { upsertNarration } from './narrationQueries.sql';

vi.mock('./connection', () => ({ sql: Object.assign(vi.fn(), { begin: vi.fn() }) }));

const NARRATION = {
  fileName: 'ほん',
  directory: 'd',
  audioKey: 'ほん.m4a',
  unitCount: 2,
  cues: [{ start: 0, end: 1.5 }, null],
};

function runTransactionsOn(transaction: ReturnType<typeof vi.fn>): void {
  vi.mocked(sql.begin).mockImplementation(((callback: (tx: typeof transaction) => unknown) => Promise.resolve(callback(transaction))) as never);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('upsertNarration', () => {
  it('writes inside a transaction, so a commit-time conflict reaches the caller', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await upsertNarration(NARRATION);

    expect(sql).not.toHaveBeenCalled();
    expect(sql.begin).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('sends the cues as JSON text', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    runTransactionsOn(transaction);

    await upsertNarration(NARRATION);

    expect(transaction.mock.calls[0]).toContain(JSON.stringify(NARRATION.cues));
  });
});
