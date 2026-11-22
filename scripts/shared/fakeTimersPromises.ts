/**
 * Test stand-in for node:timers/promises, whose setTimeout vi.useFakeTimers() leaves real. This one
 * runs on the global setTimeout, which the fake timers replace, and keeps the AbortSignal behaviour.
 * Use it with: vi.mock('node:timers/promises', () => import('<path>/fakeTimersPromises'));
 */
export function setTimeout<Value>(delayMs: number, value?: Value, options: { signal?: AbortSignal } = {}): Promise<Value | undefined> {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = globalThis.setTimeout(() => resolve(value), delayMs);
    signal?.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
