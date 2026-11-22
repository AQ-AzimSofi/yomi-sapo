import { describe, expect, it } from 'vitest';
import { runWorkerPool } from './workerPool';

interface PendingJob {
  job: number;
  workerIndex: number;
  finish: () => void;
  fail: (error: Error) => void;
}

/** Jobs that wait until the test finishes or fails them, so a test can see what is in flight. */
function createControlledJobs() {
  const startedJobs: PendingJob[] = [];
  const runJob = (job: number, workerIndex: number) =>
    new Promise<void>((resolve, reject) => {
      startedJobs.push({ job, workerIndex, finish: resolve, fail: reject });
    });
  return { startedJobs, runJob };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('runWorkerPool', () => {
  it('Test_runWorkerPool_StartsAtMostWorkerCountJobsInOrder', async () => {
    const { startedJobs, runJob } = createControlledJobs();
    const pool = runWorkerPool({ jobs: [0, 1, 2, 3], workerCount: 2, signal: new AbortController().signal, runJob });
    await settle();
    expect(startedJobs.map(({ job, workerIndex }) => [job, workerIndex])).toEqual([[0, 0], [1, 1]]);

    startedJobs[1].finish();
    await settle();
    expect(startedJobs.map(({ job, workerIndex }) => [job, workerIndex])).toEqual([[0, 0], [1, 1], [2, 1]]);

    startedJobs[0].finish();
    startedJobs[2].finish();
    await settle();
    startedJobs[3].finish();
    await expect(pool).resolves.toBeUndefined();
    expect(startedJobs.map(({ job }) => job)).toEqual([0, 1, 2, 3]);
  });

  it('Test_runWorkerPool_MoreWorkersThanJobs', async () => {
    const finishedJobs: number[] = [];
    await runWorkerPool({ jobs: [0], workerCount: 3, signal: new AbortController().signal, runJob: async (job) => void finishedJobs.push(job) });
    expect(finishedJobs).toEqual([0]);
  });

  it('Test_runWorkerPool_FailureStopsNewJobsAndIsThrownOnceJobsInFlightFinish', async () => {
    const { startedJobs, runJob } = createControlledJobs();
    const pool = runWorkerPool({ jobs: [0, 1, 2, 3], workerCount: 2, signal: new AbortController().signal, runJob });
    const outcome = pool.then(() => 'resolved', (error: Error) => error.message);
    await settle();

    startedJobs[0].fail(new Error('usage limit'));
    await settle();
    expect(startedJobs.map(({ job }) => job)).toEqual([0, 1]);
    expect(await Promise.race([outcome, settle().then(() => 'still running')])).toBe('still running');

    startedJobs[1].finish();
    expect(await outcome).toBe('usage limit');
    expect(startedJobs.map(({ job }) => job)).toEqual([0, 1]);
  });

  it('Test_runWorkerPool_AbortStopsNewJobsAndIgnoresTheirErrors', async () => {
    const { startedJobs, runJob } = createControlledJobs();
    const stopController = new AbortController();
    const pool = runWorkerPool({ jobs: [0, 1, 2], workerCount: 1, signal: stopController.signal, runJob });
    await settle();

    stopController.abort();
    startedJobs[0].fail(new Error('This operation was aborted'));
    await expect(pool).resolves.toBeUndefined();
    expect(startedJobs.map(({ job }) => job)).toEqual([0]);
  });

  it('Test_runWorkerPool_AbortedBeforeStartRunsNothing', async () => {
    const { startedJobs, runJob } = createControlledJobs();
    await runWorkerPool({ jobs: [0, 1], workerCount: 2, signal: AbortSignal.abort(), runJob });
    expect(startedJobs).toEqual([]);
  });
});
