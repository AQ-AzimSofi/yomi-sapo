/**
 * Narration manifest for one text variant of a book.
 *
 * The recording itself is private, so this returns a short-lived presigned URL
 * rather than a durable one. Requires a session: the recordings are purchased
 * audiobooks and must not be reachable by the guest preview.
 */

import { NextResponse } from 'next/server';
import { getNarration } from '@/lib/db/narrationQueries.sql';
import { withAuth } from '@/lib/auth/guards';
import { apiError } from '@/lib/api/respond';
import { presignGet } from '@/lib/storage/s3';
import { bookRefFromParams, isSafeBookRef } from '@/lib/books/bookRef';
import type { NarrationManifest } from '@/lib/types';

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
  const book = bookRefFromParams(directory, fileName);
  if (!isSafeBookRef(book)) {
    return apiError(400, 'invalid_request', 'fileName and directory must stay inside the book folders');
  }

  const bucket = process.env.NARRATION_AUDIO_BUCKET;
  if (!bucket) {
    console.error('NARRATION_AUDIO_BUCKET is not configured');
    return apiError(500, 'not_configured', 'Narration storage is not configured');
  }

  const narration = await getNarration(book.fileName, book.directory);
  if (!narration) {
    return apiError(404, 'not_found', 'No narration for this text');
  }

  const audioUrl = await presignGet(bucket, narration.audio_key, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json<NarrationManifest>({
    audioUrl,
    unitCount: narration.unit_count,
    cues: narration.cues,
  });
});
