import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgClient } from './pgClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPgClient', () => {
  it('logs a dropped connection instead of throwing it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = createPgClient({ connectionString: 'postgresql://localhost/unused' }, 'prod');

    expect(() => client.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(logged).toHaveBeenCalledWith('[db] prod connection lost: Connection terminated unexpectedly');
  });
});
