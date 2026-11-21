/**
 * ブックマークデータを更新するためのAPIルート
 * Uses PostgreSQL database
 */

import { NextResponse } from 'next/server';
import { upsertBookmark } from '@/lib/db/queries';
import { isAuthenticated } from '@/lib/auth/apiSession';
import type { BookmarkRequest, WriteResponse } from '@/lib/types';

// Mark as dynamic to prevent static generation during build
export const dynamic = 'force-dynamic';

function validPage(page: unknown): number | undefined {
  return Number.isInteger(page) && (page as number) >= 1 ? (page as number) : undefined;
}

export async function POST(request: Request): Promise<NextResponse<WriteResponse>> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
  }

  if (request.headers.get('content-type') !== 'application/json') {
    return NextResponse.json(
      { message: '無効なContent-Typeです' },
      { status: 400 }
    );
  }

  try {
    const { target, content, page }: BookmarkRequest = await request.json();

    if (!target || content === undefined) {
      return NextResponse.json(
        { message: '必須フィールドがありません: targetとcontent' },
        { status: 400 }
      );
    }

    // バリデーション（ディレクトリトラバーサル攻撃を防ぐ）
    if (target.includes('..')) {
      return NextResponse.json(
        { message: '無効なファイル名です' },
        { status: 400 }
      );
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

    return NextResponse.json({ success: true, message: 'ブックマークを更新しました' });
  } catch (error) {
    console.error('ブックマークの更新中にエラーが発生しました:', error);
    console.error('エラー詳細:', error instanceof Error ? error.message : String(error));
    console.error('スタックトレース:', error instanceof Error ? error.stack : 'スタックトレースなし');
    return NextResponse.json(
      { message: 'ブックマークの更新に失敗しました' },
      { status: 500 }
    );
  }
}
