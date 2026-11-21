/**
 * Copies a book file from the local public/ folder into text_entries.
 * The book pipeline calls this on the local dev server.
 */

import { NextResponse } from 'next/server';
import { upsertTextEntry } from '@/lib/db/queries';
import { readTextFile } from '@/lib/services/fileService';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isRecord } from '@/lib/utils/typeGuards';
import { isSafeBookRef, toBookKey, type BookRef } from '@/lib/books/bookRef';

// Mark as dynamic to prevent static generation during build
export const dynamic = 'force-dynamic';

function isTextEntryLocation(body: unknown): body is BookRef {
  return isRecord(body) && isNonEmptyString(body.fileName) && isNonEmptyString(body.directory);
}

/**
 * PUT /api/text-entries
 * Update/re-migrate specific file from filesystem to database
 * Body: { fileName: string, directory: string }
 *
 * Only the local dev server has the book files under public/, and the book
 * pipeline calls this there without credentials, so production never serves it.
 */
export const PUT = withAuth('public', async (request) => {
  if (process.env.NODE_ENV !== 'development') {
    return apiError(404, 'not_found', 'text-entries PUT runs only on the local dev server (NODE_ENV=development)');
  }

  if (request.headers.get('content-type') !== 'application/json') {
    return apiError(400, 'invalid_request', 'Invalid Content-Type');
  }

  const book = await parseJsonBody(request, isTextEntryLocation, 'Missing required fields: fileName and directory');
  if (book instanceof Response) return book;
  const { fileName, directory } = book;

  // Validation (prevent directory traversal attacks)
  if (!isSafeBookRef(book)) {
    return apiError(400, 'invalid_request', 'Invalid file name or directory');
  }

  // Read file from filesystem
  const filePath = toBookKey(book);
  const content = await readTextFile(filePath);

  if (!content) {
    return apiError(404, 'not_found', `File not found or empty: ${filePath}`);
  }

  // Update database entry
  await upsertTextEntry(fileName, content, directory);
  console.log(`Updated text entry: ${directory}/${fileName} (${content.length} chars)`);

  return NextResponse.json({
    success: true,
    message: 'Text entry updated successfully',
    updated: {
      fileName,
      directory,
      charCount: content.length
    }
  });
});
