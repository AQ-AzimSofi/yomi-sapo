import { describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { assertDirectSource, describeReport, main, parseCopyArgs, type CopyReport } from './copy-to-dsql';

vi.mock('postgres', () => ({ default: vi.fn() }));

const ENDPOINT = 'abc123.dsql.ap-northeast-1.on.aws';
const SOURCE_URL = 'postgresql://owner:secret@ep-example.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

describe('parseCopyArgs', () => {
  it('copies into the cluster as admin', () => {
    expect(parseCopyArgs(['--endpoint', ENDPOINT])).toEqual({
      target: { endpoint: ENDPOINT, region: 'ap-northeast-1', user: 'admin' },
      shouldDeleteExtra: false,
    });
  });

  it('deletes extra rows only when asked', () => {
    expect(parseCopyArgs(['--endpoint', ENDPOINT, '--delete-extra']).shouldDeleteExtra).toBe(true);
  });

  it.each([
    [[]],
    [['--endpoint', 'ep-example.ap-southeast-1.aws.neon.tech']],
    [['--endpoint', 'localhost']],
    [['--endpoint', ENDPOINT, '--force']],
    [[ENDPOINT]],
  ])('refuses %j, so the copy never writes anywhere but a DSQL cluster', (args) => {
    expect(() => parseCopyArgs(args)).toThrow(/usage/);
  });
});

describe('assertDirectSource', () => {
  it('accepts a direct Neon endpoint', () => {
    expect(() => assertDirectSource(SOURCE_URL)).not.toThrow();
  });

  it('refuses the pooled endpoint', () => {
    expect(() => assertDirectSource(SOURCE_URL.replace('ep-example', 'ep-example-pooler'))).toThrow(/remove -pooler/);
  });
});

describe('main', () => {
  it('connects to nothing without SOURCE_URL', async () => {
    await expect(main(['--endpoint', ENDPOINT], {})).rejects.toThrow(/SOURCE_URL is not set/);
    expect(postgres).not.toHaveBeenCalled();
  });

  it('connects to nothing when the target is not a DSQL endpoint', async () => {
    await expect(main(['--endpoint', 'localhost'], { SOURCE_URL })).rejects.toThrow(/usage/);
    expect(postgres).not.toHaveBeenCalled();
  });
});

describe('describeReport', () => {
  const verification = { table: 'bookmarks', expected: 2, actual: 2, identical: 2, missing: [], extra: [], different: [] };

  it('says every row is identical when no row differs', () => {
    const report: CopyReport = { tables: [{ table: 'bookmarks', written: 2, deleted: 0, verification }], sequences: ['bookmarks_id_seq next 3'] };

    expect(describeReport(report)).toEqual([
      'Verification:',
      '  bookmarks: 2 of 2 identical; missing 0, extra 0, different 0',
      'Sequences: bookmarks_id_seq next 3',
      'Every row is identical.',
    ]);
  });

  it('names the rows that differ', () => {
    const report: CopyReport = {
      tables: [{ table: 'bookmarks', written: 2, deleted: 0, verification: { ...verification, identical: 1, extra: ['["9"]'], different: ['["2"]'] } }],
      sequences: [],
    };

    expect(describeReport(report)).toEqual([
      'Verification:',
      '  bookmarks: 1 of 2 identical; missing 0, extra 1, different 1',
      '    extra: ["9"]',
      '    different: ["2"]',
      'Sequences: none',
      'Some rows differ. Fix the cause and run the copy again.',
    ]);
  });
});
