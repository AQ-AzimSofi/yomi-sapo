import { describe, expect, it, vi } from 'vitest';
import { shareRequest } from './shareRequest';

function deferred<T>() {
  const handlers: { resolve: (value: T) => void; reject: (error: unknown) => void } = { resolve: () => {}, reject: () => {} };
  const promise = new Promise<T>((resolve, reject) => Object.assign(handlers, { resolve, reject }));
  return { promise, ...handlers };
}

describe('shareRequest', () => {
  it('starts one request for callers asking for the same key while it is out', async () => {
    const pending = new Map<string, Promise<string>>();
    const answer = deferred<string>();
    const start = vi.fn(() => answer.promise);

    const first = shareRequest(pending, 'a', start);
    const second = shareRequest(pending, 'a', start);
    answer.resolve('説明');

    expect(start).toHaveBeenCalledTimes(1);
    expect(await first).toBe('説明');
    expect(await second).toBe('説明');
  });

  it('starts separate requests for different keys', () => {
    const pending = new Map<string, Promise<string>>();
    const start = vi.fn(() => new Promise<string>(() => {}));

    shareRequest(pending, 'a', start);
    shareRequest(pending, 'b', start);

    expect(start).toHaveBeenCalledTimes(2);
  });

  it('starts a new request once the last one has answered', async () => {
    const pending = new Map<string, Promise<string>>();
    const start = vi.fn(() => Promise.resolve('説明'));

    await shareRequest(pending, 'a', start);
    await shareRequest(pending, 'a', start);

    expect(start).toHaveBeenCalledTimes(2);
    expect(pending.size).toBe(0);
  });

  it('lets the next caller retry after a failure', async () => {
    const pending = new Map<string, Promise<string>>();
    const start = vi.fn().mockRejectedValueOnce(new Error('失敗')).mockResolvedValueOnce('説明');

    await expect(shareRequest(pending, 'a', start)).rejects.toThrow('失敗');
    expect(await shareRequest(pending, 'a', start)).toBe('説明');
    expect(pending.size).toBe(0);
  });
});
