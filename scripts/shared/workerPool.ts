export interface WorkerPoolRun<Job> {
  /** Started in this order, each on the first worker that is free. */
  jobs: readonly Job[];
  workerCount: number;
  /** Aborting it stops the pool: no job starts after it, and errors from jobs in flight are not reported. */
  signal: AbortSignal;
  runJob: (job: Job, workerIndex: number) => Promise<void>;
}

/**
 * Runs the jobs on workerCount workers. The first job that throws stops the pool: no new job
 * starts, the jobs in flight finish (they were already paid for), and that error is thrown.
 */
export async function runWorkerPool<Job>(run: WorkerPoolRun<Job>): Promise<void> {
  const waitingJobs = [...run.jobs];
  const failures: unknown[] = [];

  const runWorker = async (workerIndex: number): Promise<void> => {
    const isStopped = run.signal.aborted || failures.length > 0;
    if (isStopped || waitingJobs.length === 0) return;
    const [job] = waitingJobs.splice(0, 1);
    const isJobDone = await run.runJob(job, workerIndex).then(
      () => true,
      (error: unknown) => {
        if (!run.signal.aborted) failures.push(error);
        return false;
      },
    );
    if (!isJobDone) return;
    return runWorker(workerIndex);
  };

  const workerCount = Math.min(run.workerCount, waitingJobs.length);
  await Promise.all(Array.from({ length: workerCount }, (_, workerIndex) => runWorker(workerIndex)));
  if (failures.length > 0) throw failures[0];
}
