/**
 * Serves a book's text from the database to the reader.
 * The response carries an ETag of the stored version. The reader keeps a copy
 * and sends that ETag in x-book-version (CloudFront drops If-None-Match), so
 * reopening an unchanged book costs a 204 instead of re-sending the whole text.
 */

import { NextResponse } from 'next/server';
import { getTextEntry, getTextEntryVersion } from '@/lib/db/queries';
import { guestPreviewOnly, withAuth } from '@/lib/auth/guards';
import { apiError, internalError } from '@/lib/api/respond';
import { findPublicBook } from '@/lib/publicBooks';
import { LEGACY_BOOK_DIRECTORY, bookRefFromParams, isSafeBookRef, type BookRef } from '@/lib/books/bookRef';
import { truncateToPreviewPages } from '@/lib/utils/truncatePreview';
import { PAGINATION_CONFIG } from '@/lib/constants';
import { BOOK_VERSION_HEADER, ifNoneMatchIncludes } from '@/lib/utils/etag';
import type { BookTextResponse } from '@/lib/api/contracts';

export const dynamic = 'force-dynamic';

// Bump when the response body changes for the same stored text (its JSON shape,
// or how a preview is cut), so readers drop copies stored by an older deploy.
const RESPONSE_FORMAT = 'v1';

/**
 * Readers loaded before directory and fileName were sent apart send one combined
 * path. Try every directory/file split, most nested first ("a/b/c" -> a/b + c,
 * then a + b/c), then the legacy public folder.
 */
function legacyCandidates(bookKey: string): BookRef[] {
  const parts = bookKey.split('/');
  const splits = Array.from({ length: parts.length - 1 }, (_, offset) => parts.length - 1 - offset).map((splitAt) => ({
    directory: parts.slice(0, splitAt).join('/'),
    fileName: parts.slice(splitAt).join('/'),
  }));
  return [...splits, { directory: LEGACY_BOOK_DIRECTORY, fileName: bookKey }];
}

async function locateBook(candidates: BookRef[]): Promise<(BookRef & { version: string }) | null> {
  for (const candidate of candidates) {
    const version = await getTextEntryVersion(candidate.fileName, candidate.directory);
    if (version) return { ...candidate, version };
  }
  return null;
}

function cacheHeaders(etag: string): HeadersInit {
  return { ETag: etag, 'Cache-Control': 'private, no-cache' };
}

export const GET = withAuth('viewer', async (request, viewer) => {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('fileName');
  const directory = searchParams.get('directory');

  const book = fileName ? bookRefFromParams(directory, fileName) : null;
  if (!book || !isSafeBookRef(book)) {
    return apiError(400, 'invalid_request', 'fileName is required and must stay inside the book folders');
  }
  const legacyKey = directory ? null : fileName;

  try {
    // Guests may only read allowlisted books, and only a short page preview.
    const publicBook = viewer === 'owner' ? null : findPublicBook(book.directory, book.fileName);
    if (viewer === 'guest' && !publicBook) {
      return guestPreviewOnly();
    }

    const location = await locateBook(legacyKey ? legacyCandidates(legacyKey) : [book]);
    if (!location) {
      return NextResponse.json<BookTextResponse>({ text: '' });
    }

    const variant = publicBook ? `preview${publicBook.maxPreviewPages}x${PAGINATION_CONFIG.ITEMS_PER_PAGE}` : 'full';
    const etag = `"${location.version}-${variant}-${RESPONSE_FORMAT}"`;
    if (ifNoneMatchIncludes(request.headers.get(BOOK_VERSION_HEADER), etag)) {
      return new NextResponse(null, { status: 204, headers: cacheHeaders(etag) });
    }
    if (ifNoneMatchIncludes(request.headers.get('if-none-match'), etag)) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders(etag) });
    }

    const content = await getTextEntry(location.fileName, location.directory);
    // A book removed between the two reads must not be cached under its old version.
    if (!content) {
      return NextResponse.json<BookTextResponse>({ text: '' });
    }
    const text = publicBook ? truncateToPreviewPages(content, publicBook.maxPreviewPages) : content;
    return NextResponse.json<BookTextResponse>({ text }, { headers: cacheHeaders(etag) });
  } catch (error) {
    console.error('Failed to read book text:', { fileName, directory }, error);
    return internalError();
  }
});
