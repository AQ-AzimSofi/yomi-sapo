import { describe, expect, it } from 'vitest';
import { parseCleanupFlags } from './cleanupFlags';

describe('parseCleanupFlags', () => {
  it('defaults to a local dry run', () => {
    expect(parseCleanupFlags([])).toEqual({ isProd: false, shouldApply: false });
  });

  it('reads --prod and --apply in any order', () => {
    expect(parseCleanupFlags(['--apply', '--prod'])).toEqual({ isProd: true, shouldApply: true });
  });

  it.each(['--production', '--Prod', '--apply=1', 'prod'])('rejects the unknown argument %s', (arg) => {
    expect(() => parseCleanupFlags([arg])).toThrow(`Unknown arguments: ${arg}`);
  });
});
