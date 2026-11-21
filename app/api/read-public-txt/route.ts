/**
 * Serves a book's text from the database to the reader.
 * The response carries an ETag of the stored version, so reopening an
 * unchanged book costs a 304 instead of re-sending the whole text.
 */

import { NextResponse } from 'next/server';
import { getTextEntry, getTextEntryVersion } from '@/lib/db/queries';
import { isAuthenticated } from '@/lib/auth/apiSession';
import { findPublicBookByPath } from '@/lib/publicBooks';
import { truncateToPreviewPages } from '@/lib/utils/truncatePreview';
import { ifNoneMatchIncludes } from '@/lib/utils/etag';

export const dynamic = 'force-dynamic';

interface BookLocation {
  directory: string;
  file: string;
}

/**
 * The reader sends one combined path. Try every directory/file split, most
 * nested first ("a/b/c" -> a/b + c, then a + b/c), then the legacy public folder.
 */
function candidateLocations(fileName: string, directory: string | null): BookLocation[] {
  if (directory) return [{ directory, file: fileName }];
  const parts = fileName.split('/');
  const splits = Array.from({ length: parts.length - 1 }, (_, offset) => parts.length - 1 - offset).map((splitAt) => ({
    directory: parts.slice(0, splitAt).join('/'),
    file: parts.slice(splitAt).join('/'),
  }));
  return [...splits, { directory: 'public', file: fileName }];
}

async function locateBook(candidates: BookLocation[]): Promise<(BookLocation & { version: string }) | null> {
  for (const candidate of candidates) {
    const version = await getTextEntryVersion(candidate.file, candidate.directory);
    if (version) return { ...candidate, version };
  }
  return null;
}

function cacheHeaders(etag: string): HeadersInit {
  return { ETag: etag, 'Cache-Control': 'private, no-cache' };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('fileName');
  const directory = searchParams.get('directory');

  if (!fileName || fileName.includes('..') || directory?.includes('..')) {
    return NextResponse.json({ text: '' }, { status: 400 });
  }

  try {
    // Guests may only read allowlisted books, and only a short page preview.
    const requestedPath = directory ? `${directory}/${fileName}` : fileName;
    const authed = await isAuthenticated();
    const publicBook = authed ? null : findPublicBookByPath(requestedPath);
    if (!authed && !publicBook) {
      return NextResponse.json({ text: '' }, { status: 403 });
    }

    const location = await locateBook(candidateLocations(fileName, directory));
    if (!location) {
      return NextResponse.json({ text: '' });
    }

    const variant = publicBook ? `preview${publicBook.maxPreviewPages}` : 'full';
    const etag = `"${location.version}-${variant}"`;
    if (ifNoneMatchIncludes(request.headers.get('if-none-match'), etag)) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders(etag) });
    }

    const content = await getTextEntry(location.file, location.directory);
    // A book removed between the two reads must not be cached under its old version.
    if (!content) {
      return NextResponse.json({ text: '' });
    }
    const text = publicBook ? truncateToPreviewPages(content, publicBook.maxPreviewPages) : content;
    return NextResponse.json({ text }, { headers: cacheHeaders(etag) });
  } catch (error) {
    console.error('Failed to read book text:', { fileName, directory }, error);
    return NextResponse.json({ text: '' }, { status: 500 });
  }
}
