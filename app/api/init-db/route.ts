import { sql } from '@/lib/db/connection';
import { NextResponse } from 'next/server';
import { CREATE_TABLES_SQL, MIGRATIONS_SQL } from '@/lib/db/schema';
import { isAuthenticated } from '@/lib/auth/apiSession';

// `npm run db:init` calls this on the local dev server without a cookie; in
// production only the signed-in owner may run schema changes.
export async function GET() {
  const isDevServer = process.env.NODE_ENV === 'development';
  if (!isDevServer && !(await isAuthenticated())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    await sql.unsafe(CREATE_TABLES_SQL);
    await sql.unsafe(MIGRATIONS_SQL);

    return NextResponse.json({
      message: 'Database tables created successfully',
      success: true,
    });
  } catch (error) {
    console.error('Database initialization error:', error);
    return NextResponse.json(
      {
        message: 'Failed to initialize database',
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      },
      { status: 500 }
    );
  }
}
