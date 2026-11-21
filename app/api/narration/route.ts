/**
 * Narration manifest for one text variant of a book.
 *
 * The recording itself is private, so this returns a short-lived presigned URL
 * rather than a durable one. Requires a session: the recordings are purchased
 * audiobooks and must not be reachable by the guest preview.
 */

import { NextResponse } from 'next/server';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getNarration } from '@/lib/db/narrationQueries.sql';
import { withAuth } from '@/lib/auth/guards';
import { apiError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

// Long enough to listen through a full book without the URL expiring mid-seek,
// short enough that a copied link is not a durable handout.
const SIGNED_URL_TTL_SECONDS = 12 * 60 * 60;

export const GET = withAuth('owner', async (request) => {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('fileName');
  const directory = searchParams.get('directory');
  if (!fileName || !directory) {
    return apiError(400, 'invalid_request', 'fileName and directory are required');
  }

  const bucket = process.env.NARRATION_AUDIO_BUCKET;
  if (!bucket) {
    console.error('NARRATION_AUDIO_BUCKET is not configured');
    return apiError(500, 'not_configured', 'Narration storage is not configured');
  }

  const narration = await getNarration(fileName, directory);
  if (!narration) {
    return apiError(404, 'not_found', 'No narration for this text');
  }

  const audioUrl = await getSignedUrl(
    new S3Client({}),
    new GetObjectCommand({ Bucket: bucket, Key: narration.audio_key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS }
  );

  return NextResponse.json({
    audioUrl,
    unitCount: narration.unit_count,
    cues: narration.cues,
  });
});
