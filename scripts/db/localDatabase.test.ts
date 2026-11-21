import { describe, expect, it } from 'vitest';
import { isLocalDatabase } from './localDatabase';

describe('isLocalDatabase', () => {
  it.each(['localhost', '127.0.0.1'])('accepts %s', (host) => {
    expect(isLocalDatabase([host])).toBe(true);
  });

  it('refuses a remote host', () => {
    expect(isLocalDatabase(['ep-example.ap-southeast-1.aws.neon.tech'])).toBe(false);
  });

  it('refuses a host list that includes a remote host', () => {
    expect(isLocalDatabase(['localhost', 'db.example.com'])).toBe(false);
  });

  it('refuses an empty host list', () => {
    expect(isLocalDatabase([])).toBe(false);
  });
});
