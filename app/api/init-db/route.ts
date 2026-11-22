import { sql } from '@/lib/db/connection';
import { NextResponse } from 'next/server';
import { applySchema } from '@/lib/db/schemaRunner';
import { signInRequired, withAuth } from '@/lib/auth/guards';

// `npm run db:init` calls this on the local dev server without a cookie; in
// production only the signed-in owner may run schema changes.
export const GET = withAuth('viewer', async (request, viewer) => {
  const isDevServer = process.env.NODE_ENV === 'development';
  if (!isDevServer && viewer !== 'owner') {
    return signInRequired();
  }

  await applySchema(sql);

  return NextResponse.json({
    message: 'Database tables created successfully',
    success: true,
  });
});
