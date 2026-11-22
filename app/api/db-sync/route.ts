import { NextResponse } from 'next/server';
import {
  computeDiffs,
  pull,
  push,
  fullSync,
  withClients,
} from '@/lib/db/sync-core';
import { PROD_DATABASE_VARIABLES, readProdDatabase, type ProdDatabase } from '@/lib/db/prodDatabase';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isRecord } from '@/lib/utils/typeGuards';
import type { DbSyncDirection, DbSyncRequest, DbSyncResponse, DbSyncStatusResponse } from '@/lib/api/contracts';

export const dynamic = 'force-dynamic';

const SYNC_DIRECTIONS: readonly DbSyncDirection[] = ['pull', 'push', 'full'];

function isSyncRequest(body: unknown): body is DbSyncRequest {
  return isRecord(body) && SYNC_DIRECTIONS.some((direction) => direction === body.direction);
}

interface SyncDatabases {
  prod: ProdDatabase;
  localUrl: string;
}

function readSyncDatabases(): SyncDatabases | NextResponse {
  const prod = readProdDatabase(process.env);
  if (!prod) {
    return apiError(503, 'not_configured', `Sync not available - ${PROD_DATABASE_VARIABLES} not configured`);
  }
  const localUrl = process.env.DATABASE_URL;
  if (!localUrl) {
    return apiError(503, 'not_configured', 'Sync not available - DATABASE_URL not configured');
  }
  return { prod, localUrl };
}

export const GET = withAuth('owner', async () => {
  const databases = readSyncDatabases();
  if (databases instanceof Response) return databases;

  const diffs = await withClients(databases.prod, databases.localUrl, computeDiffs);
  return NextResponse.json<DbSyncStatusResponse>({ diffs });
});

export const POST = withAuth('owner', async (request) => {
  const databases = readSyncDatabases();
  if (databases instanceof Response) return databases;

  const body = await parseJsonBody(request, isSyncRequest, 'Invalid direction. Use pull, push, or full');
  if (body instanceof Response) return body;
  const { direction } = body;

  const results = await withClients(databases.prod, databases.localUrl, (prod, local) => {
    if (direction === 'pull') return pull(prod, local);
    if (direction === 'push') return push(prod, local);
    return fullSync(prod, local);
  });

  return NextResponse.json<DbSyncResponse>({ success: true, results });
});
