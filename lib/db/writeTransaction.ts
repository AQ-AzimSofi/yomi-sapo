import type postgres from 'postgres';

export interface WriteRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export const DEFAULT_WRITE_RETRY: WriteRetryPolicy = { maxAttempts: 5, baseDelayMs: 20 };

// Aurora DSQL answers both a write-write conflict (OC000) and a schema change by
// another transaction (OC001) with this SQLSTATE; nothing was committed, so the
// whole unit can run again.
const SERIALIZATION_FAILURE = '40001';

export type WriteWork = (tx: postgres.TransactionSql) => Promise<unknown>;

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === SERIALIZATION_FAILURE;
}

/** Exponential steps, each scaled by a random factor in [0.5, 1.5) so writers that collided do not collide again. */
export function retryDelayMs(attempt: number, baseDelayMs: number, random: () => number = Math.random): number {
  return baseDelayMs * 2 ** (attempt - 1) * (0.5 + random());
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Runs a unit of writes in one transaction and runs the whole unit again on
 * SQLSTATE 40001, with jittered exponential backoff, up to policy.maxAttempts.
 *
 * Every app write goes through here, never through a single autocommit statement:
 * on Aurora DSQL, postgres.js reports an autocommit write as done before the
 * commit, so a commit-time conflict or size error is silently dropped and the
 * write is lost; inside sql.begin the COMMIT reports it. On PostgreSQL (Neon) the
 * cost is the BEGIN and COMMIT round trips.
 */
export async function runWriteTransaction(
  client: Pick<postgres.Sql, 'begin'>,
  work: WriteWork,
  policy: WriteRetryPolicy = DEFAULT_WRITE_RETRY
): Promise<void> {
  const runAttempt = async (attempt: number): Promise<void> => {
    try {
      await client.begin(work);
    } catch (error) {
      if (!isSerializationFailure(error) || attempt >= policy.maxAttempts) throw error;
      await sleep(retryDelayMs(attempt, policy.baseDelayMs));
      return runAttempt(attempt + 1);
    }
  };
  return runAttempt(1);
}
