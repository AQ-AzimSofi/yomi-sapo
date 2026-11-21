/**
 * ブックマークデータを読み込むためのAPIルート
 * Uses PostgreSQL database
 */

import { NextResponse } from 'next/server';
import { getBookmark } from '@/lib/db/queries';
import { DEFAULT_FILE_NAME } from '@/lib/constants';
import { bookRefFromParams, isSafeBookRef } from '@/lib/books/bookRef';
import { withAuth } from '@/lib/auth/guards';
import { apiError } from '@/lib/api/respond';
import type { BookmarkResponse } from '@/lib/api/contracts';

// Mark as dynamic to prevent static generation during build
export const dynamic = 'force-dynamic';

// Guests have no personal bookmarks and must not see the owner's saved position.
// The reader and the library treat any failed response as "no bookmark".
export const GET = withAuth('owner', async (request) => {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('fileName') || DEFAULT_FILE_NAME;
  const book = fileName ? bookRefFromParams(searchParams.get('directory'), fileName) : null;

  // バリデーション（ディレクトリトラバーサル攻撃を防ぐ）
  if (!book || !isSafeBookRef(book)) {
    console.error(`無効なファイル名: "${fileName}"`);
    return apiError(400, 'invalid_request', 'Invalid file name');
  }

  const bookmark = await getBookmark(book.fileName, book.directory);
  return NextResponse.json<BookmarkResponse>(bookmark);
});
