/**
 * Cover image for one library book, read from the private BookCovers bucket.
 *
 * Deliberately public: CloudFront's cache key ignores cookies, so a cached cover is
 * served to everyone anyway, and covers are the publishers' public artwork. The
 * s-maxage lets CloudFront answer repeat requests without invoking the server.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { apiError } from '@/lib/api/respond';
import { readObjectBytes } from '@/lib/storage/s3';
import { bookRefFromParams, isSafeBookRef, toBookKey } from '@/lib/books/bookRef';

export const dynamic = 'force-dynamic';

// A day, so a corrected cover replaces a wrong one without a CloudFront invalidation.
// Only 200s are cached: OpenNext forces no-store on 404/500 responses.
const COVER_CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400';

export const GET = withAuth('public', async (request) => {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('fileName');
  const directory = searchParams.get('directory');
  if (!fileName || !directory) {
    return apiError(400, 'invalid_request', 'fileName and directory are required');
  }
  const book = bookRefFromParams(directory, fileName);
  if (!isSafeBookRef(book)) {
    return apiError(400, 'invalid_request', 'fileName and directory must stay inside the book folders');
  }

  const bucket = process.env.BOOK_COVERS_BUCKET;
  if (!bucket) {
    console.error('BOOK_COVERS_BUCKET is not configured');
    return apiError(500, 'not_configured', 'Cover storage is not configured');
  }

  const coverBytes = await readObjectBytes(bucket, `covers/${toBookKey(book)}.jpg`);
  if (!coverBytes) {
    return apiError(404, 'not_found', 'No cover for this book');
  }
  return new NextResponse(coverBytes, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': COVER_CACHE_CONTROL },
  });
});
