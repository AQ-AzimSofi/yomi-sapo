import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import { upsertTextEntry, upsertBookmark, initializeBookmarksForFiles, backfillTextMetadata } from '@/lib/db/queries';

interface TextEntryUpload {
  fileName: string;
  directory?: string;
  content: string;
}

interface BookmarkUpload {
  fileName: string;
  directory?: string;
  bookmarkText: string;
}

// Entries are checked one by one so a bad entry fails alone instead of the whole batch.
interface BulkSeedUpload {
  entries: unknown[];
}

interface UploadResult {
  fileName: string;
  directory: string;
  success: boolean;
  error?: string;
}

function isTextEntryUpload(body: unknown): body is TextEntryUpload {
  return isRecord(body) && isNonEmptyString(body.fileName) && isNonEmptyString(body.content) && isOptionalString(body.directory);
}

function isBookmarkUpload(body: unknown): body is BookmarkUpload {
  return isRecord(body) && isNonEmptyString(body.fileName) && typeof body.bookmarkText === 'string' && isOptionalString(body.directory);
}

function isBulkSeedUpload(body: unknown): body is BulkSeedUpload {
  return isRecord(body) && Array.isArray(body.entries) && body.entries.length > 0;
}

/**
 * Consolidated admin API route
 * Handles text entries, bookmarks, and bulk operations with action routing
 *
 * POST /api/admin?action=text-entries - Upload/update text entry
 * POST /api/admin?action=bookmarks - Create/update bookmark
 * POST /api/admin?action=bulk-seed - Bulk upload multiple entries
 */
export const POST = withAuth('admin-key', async (request) => {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'text-entries') {
    return handleTextEntry(request);
  } else if (action === 'bookmarks') {
    return handleBookmark(request);
  } else if (action === 'bulk-seed') {
    return handleBulkSeed(request);
  } else if (action === 'backfill-metadata') {
    return handleBackfillMetadata();
  }

  return apiError(
    400,
    'invalid_request',
    'Invalid action. Use action=text-entries, action=bookmarks, action=bulk-seed, or action=backfill-metadata'
  );
});

async function handleTextEntry(request: Request) {
  const body = await parseJsonBody(request, isTextEntryUpload, 'fileName and content are required strings');
  if (body instanceof Response) return body;
  const { fileName, directory = 'bookv2-furigana', content } = body;

  await upsertTextEntry(fileName, content, directory);

  await initializeBookmarksForFiles([fileName], directory);

  return NextResponse.json({
    success: true,
    message: `Text entry for ${directory}/${fileName} created/updated successfully`,
    stats: {
      fileName,
      directory,
      contentLength: content.length,
    },
  });
}

async function handleBookmark(request: Request) {
  const body = await parseJsonBody(
    request,
    isBookmarkUpload,
    'fileName is required and bookmarkText must be a string (can be empty)'
  );
  if (body instanceof Response) return body;
  const { fileName, directory = 'bookv2-furigana', bookmarkText } = body;

  await upsertBookmark({ fileName, directory, bookmarkText });

  return NextResponse.json({
    success: true,
    message: `Bookmark for ${directory}/${fileName} created/updated successfully`,
    bookmark: {
      fileName,
      directory,
      bookmarkText,
    },
  });
}

async function handleBackfillMetadata() {
  const count = await backfillTextMetadata();
  return NextResponse.json({
    success: true,
    message: `Backfilled metadata for ${count} entries`,
  });
}

async function handleBulkSeed(request: Request) {
  const body = await parseJsonBody(request, isBulkSeedUpload, 'entries must be a non-empty array');
  if (body instanceof Response) return body;
  const { entries } = body;

  const results: UploadResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    const upload: Record<string, unknown> = isRecord(entry) ? entry : {};
    const { fileName, content } = upload;
    const directory = isNonEmptyString(upload.directory) ? upload.directory : 'bookv2-furigana';

    if (!isNonEmptyString(fileName)) {
      results.push({
        fileName: 'unknown',
        directory,
        success: false,
        error: 'fileName is required and must be a string',
      });
      failed++;
      continue;
    }

    if (!isNonEmptyString(content)) {
      results.push({
        fileName,
        directory,
        success: false,
        error: 'content is required and must be a string',
      });
      failed++;
      continue;
    }

    try {
      await upsertTextEntry(fileName, content, directory);
      await initializeBookmarksForFiles([fileName], directory);
      results.push({
        fileName,
        directory,
        success: true,
      });
      succeeded++;
    } catch (error) {
      // The result reaches the caller, so it names the failure without the database's own text.
      console.error(`Bulk seed failed for ${directory}/${fileName}:`, error);
      results.push({
        fileName,
        directory,
        success: false,
        error: 'Failed to save this entry',
      });
      failed++;
    }
  }

  return NextResponse.json({
    success: failed === 0,
    message: `Bulk upload completed: ${succeeded} succeeded, ${failed} failed`,
    stats: {
      total: entries.length,
      succeeded,
      failed,
    },
    results,
  });
}
