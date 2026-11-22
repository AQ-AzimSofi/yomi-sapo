import { describe, expect, it } from 'vitest';
import { DEFAULT_DSQL_USER, readDsqlSettings } from '@/lib/db/connectionConfig';
import { DSQL_APP_USER, dsqlServerAccess } from './dsqlServerAccess';

const CLUSTER = { clusterId: 'abc123', region: 'ap-northeast-1', accountId: '111122223333' };

describe('dsqlServerAccess', () => {
  it('points the app at the cluster endpoint as the app role', () => {
    expect(dsqlServerAccess(CLUSTER).environment).toEqual({
      DSQL_ENDPOINT: 'abc123.dsql.ap-northeast-1.on.aws',
      DSQL_USER: 'yomi_app',
      DSQL_REGION: 'ap-northeast-1',
    });
  });

  it('lets the server function connect to that cluster only, and not as admin', () => {
    expect(dsqlServerAccess(CLUSTER).permissions).toEqual([
      { actions: ['dsql:DbConnect'], resources: ['arn:aws:dsql:ap-northeast-1:111122223333:cluster/abc123'] },
    ]);
  });

  it('gives the app settings its connection reads as DSQL mode', () => {
    expect(readDsqlSettings(dsqlServerAccess(CLUSTER).environment)).toEqual({
      endpoint: 'abc123.dsql.ap-northeast-1.on.aws',
      user: 'yomi_app',
      region: 'ap-northeast-1',
    });
  });

  it('names the same role the app connects as by default', () => {
    expect(DSQL_APP_USER).toBe(DEFAULT_DSQL_USER);
  });

  it('refuses an empty cluster id rather than granting a malformed ARN', () => {
    expect(() => dsqlServerAccess({ ...CLUSTER, clusterId: '' })).toThrow(/cluster id/);
  });
});
