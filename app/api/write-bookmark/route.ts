/**
 * ブックマークデータを更新するためのAPIルート
 * Uses PostgreSQL database
 */

import { NextResponse } from 'next/server';
import { upsertBookmark } from '@/lib/db/queries';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isRecord } from '@/lib/utils/typeGuards';
import type { WriteResponse } from '@/lib/types';

// Mark as dynamic to prevent static generation during build
export const dynamic = 'force-dynamic';

// The page is checked separately: a bad page is dropped, not refused.
interface BookmarkBody {
  target: string;
  content: string;
  page?: unknown;
}

function isBookmarkBody(body: unknown): body is BookmarkBody {
  return isRecord(body) && isNonEmptyString(body.target) && typeof body.content === 'string';
}

function validPage(page: unknown): number | undefined {
  return Number.isInteger(page) && (page as number) >= 1 ? (page as number) : undefined;
}

export const POST = withAuth('owner', async (request) => {
  if (request.headers.get('content-type') !== 'application/json') {
    return apiError(400, 'invalid_request', '無効なContent-Typeです');
  }

  const body = await parseJsonBody(request, isBookmarkBody, '必須フィールドがありません: targetとcontent');
  if (body instanceof Response) return body;
  const { target, content, page } = body;

  // バリデーション（ディレクトリトラバーサル攻撃を防ぐ）
  if (target.includes('..')) {
    return apiError(400, 'invalid_request', '無効なファイル名です');
  }

  // Extract directory and filename - last segment is file, rest is directory
  // e.g., "bookv2-furigana/book-name/file-name" -> dir="bookv2-furigana/book-name", file="file-name"
  const parts = target.split('/');
  const directory = parts.length > 1 ? parts.slice(0, -1).join('/') : 'public';
  const file = parts[parts.length - 1];

  const bookmarkPage = validPage(page);
  if (page != null && bookmarkPage === undefined) {
    console.warn('Ignoring an invalid bookmark page:', { target, page });
  }
  await upsertBookmark({ fileName: file, directory, bookmarkText: content, bookmarkPage });

  return NextResponse.json<WriteResponse>({ success: true, message: 'ブックマークを更新しました' });
});
