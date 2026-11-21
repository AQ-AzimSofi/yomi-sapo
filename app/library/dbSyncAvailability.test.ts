import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAvailability(nodeEnv: string): Promise<boolean> {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  const { IS_DB_SYNC_AVAILABLE } = await import('./dbSyncAvailability');
  return IS_DB_SYNC_AVAILABLE;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('IS_DB_SYNC_AVAILABLE', () => {
  it('offers the sync on the local dev server', async () => {
    expect(await loadAvailability('development')).toBe(true);
  });

  it.each(['production', 'test'])('hides the sync when NODE_ENV is %s', async (nodeEnv) => {
    expect(await loadAvailability(nodeEnv)).toBe(false);
  });
});
