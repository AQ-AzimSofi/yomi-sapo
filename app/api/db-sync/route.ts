import { NextResponse } from 'next/server';
import {
  computeDiffs,
  pull,
  push,
  fullSync,
  withClients,
} from '@/lib/db/sync-core';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isRecord } from '@/lib/utils/typeGuards';

export const dynamic = 'force-dynamic';

const SYNC_DIRECTIONS = ['pull', 'push', 'full'] as const;

interface SyncRequest {
  direction: (typeof SYNC_DIRECTIONS)[number];
}

function isSyncRequest(body: unknown): body is SyncRequest {
  return isRecord(body) && SYNC_DIRECTIONS.some((direction) => direction === body.direction);
}

function ensureProdConfigured(): NextResponse | null {
  if (!process.env.PROD_DATABASE_URL) {
    return apiError(503, 'not_configured', 'Sync not available - PROD_DATABASE_URL not configured');
  }
  if (!process.env.DATABASE_URL) {
    return apiError(503, 'not_configured', 'Sync not available - DATABASE_URL not configured');
  }
  return null;
}

export const GET = withAuth('owner', async () => {
  const configError = ensureProdConfigured();
  if (configError) return configError;

  const diffs = await withClients(
    process.env.PROD_DATABASE_URL!,
    process.env.DATABASE_URL!,
    computeDiffs
  );
  return NextResponse.json({ diffs });
});

export const POST = withAuth('owner', async (request) => {
  const configError = ensureProdConfigured();
  if (configError) return configError;

  const body = await parseJsonBody(request, isSyncRequest, 'Invalid direction. Use pull, push, or full');
  if (body instanceof Response) return body;
  const { direction } = body;

  const results = await withClients(
    process.env.PROD_DATABASE_URL!,
    process.env.DATABASE_URL!,
    (prod, local) => {
      if (direction === 'pull') return pull(prod, local);
      if (direction === 'push') return push(prod, local);
      return fullSync(prod, local);
    }
  );

  return NextResponse.json({ success: true, results });
});
