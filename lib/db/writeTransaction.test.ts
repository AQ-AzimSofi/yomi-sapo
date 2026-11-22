import { afterEach, describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { retryDelayMs, retryOnSerializationFailure, runWriteTransaction } from './writeTransaction';

const NO_WAIT = { maxAttempts: 5, baseDelayMs: 0 };

function databaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const CONFLICT = databaseError('40001', 'change conflicts with another transaction (OC000)');

function fakeClient(...outcomes: (Error | null)[]) {
  const transaction = vi.fn();
  const begin = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
    const outcome = outcomes[begin.mock.calls.length - 1] ?? null;
    await work(transaction);
    if (outcome) throw outcome;
  });
  return { client: { begin } as unknown as Pick<postgres.Sql, 'begin'>, begin, transaction };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runWriteTransaction', () => {
  it('runs the work inside one transaction', async () => {
    const { client, begin, transaction } = fakeClient();
    const work = vi.fn(async (tx: unknown) => tx);

    await runWriteTransaction(client, work, NO_WAIT);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledWith(transaction);
  });

  it('runs the whole unit again after a 40001 conflict and stops once it commits', async () => {
    const { client, begin } = fakeClient(CONFLICT, null);
    const work = vi.fn(async () => undefined);

    await runWriteTransaction(client, work, NO_WAIT);

    expect(begin).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('retries a schema change by another transaction (OC001), which also arrives as 40001', async () => {
    const { client, begin } = fakeClient(databaseError('40001', 'schema has been updated by another transaction (OC001)'));

    await runWriteTransaction(client, async () => undefined, NO_WAIT);

    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('gives up with the conflict after the last attempt', async () => {
    const { client, begin } = fakeClient(CONFLICT, CONFLICT, CONFLICT);

    await expect(runWriteTransaction(client, async () => undefined, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toBe(CONFLICT);
    expect(begin).toHaveBeenCalledTimes(3);
  });

  it('does not retry any other error', async () => {
    const tooLarge = databaseError('54000', 'transaction size limit 10mb exceeded');
    const { client, begin } = fakeClient(tooLarge);

    await expect(runWriteTransaction(client, async () => undefined, NO_WAIT)).rejects.toBe(tooLarge);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error without a SQLSTATE', async () => {
    const thrown = new Error('Connection terminated unexpectedly');
    const { client, begin } = fakeClient(thrown);

    await expect(runWriteTransaction(client, async () => undefined, NO_WAIT)).rejects.toBe(thrown);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('waits before running the unit again', async () => {
    vi.useFakeTimers();
    const { client, begin } = fakeClient(CONFLICT);

    const written = runWriteTransaction(client, async () => undefined, { maxAttempts: 5, baseDelayMs: 1000 });
    await vi.advanceTimersByTimeAsync(400);
    const attemptsBeforeDelay = begin.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1100);
    await written;

    expect(attemptsBeforeDelay).toBe(1);
    expect(begin).toHaveBeenCalledTimes(2);
  });
});

describe('retryOnSerializationFailure', () => {
  it('returns what the attempt that succeeded returned', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(CONFLICT).mockResolvedValueOnce({ rowCount: 1 });

    expect(await retryOnSerializationFailure(attempt, NO_WAIT)).toEqual({ rowCount: 1 });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not retry any other error', async () => {
    const tooLarge = databaseError('08P01', 'invalid message length');
    const attempt = vi.fn().mockRejectedValue(tooLarge);

    await expect(retryOnSerializationFailure(attempt, NO_WAIT)).rejects.toBe(tooLarge);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe('retryDelayMs', () => {
  it('doubles with each attempt', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, 20, () => 0.5))).toEqual([20, 40, 80, 160]);
  });

  it('spreads each step between half and one and a half times its size', () => {
    expect(retryDelayMs(3, 20, () => 0)).toBe(40);
    expect(retryDelayMs(3, 20, () => 0.999)).toBeCloseTo(119.92);
  });
});
