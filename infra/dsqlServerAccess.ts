// Kept free of SDK and SST imports, so sst.config.ts can load it and vitest can test it.

// The database role the server function connects as. The IAM GRANT that maps the function's
// role to it is an ops step on the cluster (AWS IAM GRANT yomi_app TO '<role ARN>').
export const DSQL_APP_USER = 'yomi_app';

export interface DsqlCluster {
  clusterId: string;
  region: string;
  accountId: string;
}

export interface DsqlServerAccess {
  environment: { DSQL_ENDPOINT: string; DSQL_USER: string; DSQL_REGION: string };
  permissions: { actions: string[]; resources: string[] }[];
}

/**
 * What the server function needs to use an Aurora DSQL cluster: the environment that switches
 * lib/db/connection.ts to DSQL mode, and IAM permission to connect to that cluster as a
 * non-admin role. Lambda reserves AWS_REGION, so the region goes in DSQL_REGION.
 */
export function dsqlServerAccess(cluster: DsqlCluster): DsqlServerAccess {
  if (!cluster.clusterId) throw new Error('a DSQL cluster id is required');
  return {
    environment: {
      DSQL_ENDPOINT: `${cluster.clusterId}.dsql.${cluster.region}.on.aws`,
      DSQL_USER: DSQL_APP_USER,
      DSQL_REGION: cluster.region,
    },
    permissions: [
      {
        actions: ['dsql:DbConnect'],
        resources: [`arn:aws:dsql:${cluster.region}:${cluster.accountId}:cluster/${cluster.clusterId}`],
      },
    ],
  };
}
