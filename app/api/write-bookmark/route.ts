/**
 * ブックマークデータを更新するためのAPIルート
 * Uses PostgreSQL database
 */

import { NextResponse } from 'next/server';
import { upsertBookmark } from '@/lib/db/queries';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import { bookRefFromParams, isSafeBookRef, parseBookKey, toBookKey, type BookRef } from '@/lib/books/bookRef';
import type { WriteResponse } from '@/lib/api/contracts';

// Mark as dynamic to prevent static generation during build
export const dynamic = 'force-dynamic';

// The book is `directory` + `fileName`, or the combined `target` key that readers
// loaded before the two were sent apart still send. The page is checked
// separately: a bad page is dropped, not refused.
interface BookmarkBody {
  directory?: string;
  fileName?: string;
  target?: string;
  content: string;
  page?: unknown;
}

function isBookmarkBody(body: unknown): body is BookmarkBody {
  return (
    isRecord(body) &&
    isOptionalString(body.directory) &&
    isOptionalString(body.fileName) &&
    isOptionalString(body.target) &&
    (isNonEmptyString(body.fileName) || isNonEmptyString(body.target)) &&
    typeof body.content === 'string'
  );
}

function bookmarkedBook({ directory, fileName, target }: BookmarkBody): BookRef {
  return fileName ? bookRefFromParams(directory, fileName) : parseBookKey(target ?? '');
}

function validPage(page: unknown): number | undefined {
  return Number.isInteger(page) && (page as number) >= 1 ? (page as number) : undefined;
}

export const POST = withAuth('owner', async (request) => {
  if (request.headers.get('content-type') !== 'application/json') {
    return apiError(400, 'invalid_request', '無効なContent-Typeです');
  }

  const body = await parseJsonBody(request, isBookmarkBody, '必須フィールドがありません: fileName（またはtarget）とcontent');
  if (body instanceof Response) return body;
  const { content, page } = body;
  const book = bookmarkedBook(body);

  // バリデーション（ディレクトリトラバーサル攻撃を防ぐ）
  if (!isSafeBookRef(book)) {
    return apiError(400, 'invalid_request', '無効なファイル名です');
  }

  const bookmarkPage = validPage(page);
  if (page != null && bookmarkPage === undefined) {
    console.warn('Ignoring an invalid bookmark page:', { book: toBookKey(book), page });
  }
  await upsertBookmark({ fileName: book.fileName, directory: book.directory, bookmarkText: content, bookmarkPage });

  return NextResponse.json<WriteResponse>({ success: true, message: 'ブックマークを更新しました' });
});
