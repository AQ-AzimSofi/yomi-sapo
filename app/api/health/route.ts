import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guards';

export const GET = withAuth('public', async () => {
  return NextResponse.json({ status: 'healthy', timestamp: Date.now() });
});
