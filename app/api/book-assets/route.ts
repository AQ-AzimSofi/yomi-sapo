/**
 * Illustrations and image metadata from inside a book, read from the private
 * BookImages bucket.
 *
 * `?path=` keeps the layout these files had under public/ (`/<directory>/images/<file>`
 * and the book's metadata `.json`), so the reader's path logic is unchanged.
 * Signed-in readers may load any book; guests only the preview books. Responses are
 * `private` because CloudFront's cache key ignores the session: a shared cache would
 * hand a signed-in reader's illustrations to guests.
 */

import { NextResponse } from 'next/server';
import { guestPreviewOnly, withAuth } from '@/lib/auth/guards';
import { apiError } from '@/lib/api/respond';
import { isPublicBookAsset } from '@/lib/publicBooks';
import { readObjectBytes } from '@/lib/storage/s3';

export const dynamic = 'force-dynamic';

const ASSET_CACHE_CONTROL = 'private, max-age=86400';
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  json: 'application/json',
};

function contentTypeOf(assetPath: string): string | undefined {
  const extension = assetPath.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXTENSION[extension];
}

function isWellFormedAssetPath(assetPath: string): boolean {
  return assetPath.startsWith('/') && !assetPath.includes('\\') && !assetPath.split('/').includes('..');
}

export const GET = withAuth('viewer', async (request, viewer) => {
  const assetPath = new URL(request.url).searchParams.get('path');
  const contentType = assetPath ? contentTypeOf(assetPath) : undefined;
  if (!assetPath || !contentType || !isWellFormedAssetPath(assetPath)) {
    return apiError(400, 'invalid_request', 'path must point to a book image or metadata file');
  }

  if (viewer === 'guest' && !isPublicBookAsset(assetPath)) {
    return guestPreviewOnly();
  }

  const bucket = process.env.BOOK_IMAGES_BUCKET;
  if (!bucket) {
    console.error('BOOK_IMAGES_BUCKET is not configured');
    return apiError(500, 'not_configured', 'Book image storage is not configured');
  }

  const assetBytes = await readObjectBytes(bucket, assetPath.slice(1));
  if (!assetBytes) {
    return apiError(404, 'not_found', 'No such book asset');
  }
  return new NextResponse(assetBytes, {
    headers: { 'Content-Type': contentType, 'Cache-Control': ASSET_CACHE_CONTROL },
  });
});
