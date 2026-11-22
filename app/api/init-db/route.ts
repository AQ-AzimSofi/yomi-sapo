import { databaseKind, sql } from '@/lib/db/connection';
import { NextResponse } from 'next/server';
import { applySchema } from '@/lib/db/schemaRunner';
import { signInRequired, withAuth } from '@/lib/auth/guards';
import { apiError } from '@/lib/api/respond';

// `npm run db:init` calls this on the local dev server without a cookie; in
// production only the signed-in owner may run schema changes.
export const GET = withAuth('viewer', async (request, viewer) => {
  const isDevServer = process.env.NODE_ENV === 'development';
  if (!isDevServer && viewer !== 'owner') {
    return signInRequired();
  }

  // The app's DSQL role may not run DDL, so an admin applies the schema from a script instead.
  if (databaseKind === 'dsql') {
    return apiError(409, 'invalid_request', 'Aurora DSQL schema changes run as admin: npx tsx scripts/db/apply-schema-dsql.ts');
  }

  await applySchema(sql, 'postgres');

  return NextResponse.json({
    message: 'Database tables created successfully',
    success: true,
  });
});
