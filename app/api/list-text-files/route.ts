import { NextResponse } from 'next/server';
import { getAllTextEntries } from '@/lib/db/queries';
import { withAuth } from '@/lib/auth/guards';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';
import { toBookKey } from '@/lib/books/bookRef';
import type { TextFileListResponse } from '@/lib/api/contracts';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async (request, viewer) => {
  const { directories, filesByDirectory } = await getAllTextEntries();

  if (viewer === 'guest') {
    const available = PUBLIC_BOOKS.filter((book) =>
      (filesByDirectory[book.directory] || []).includes(book.fileName)
    );
    return NextResponse.json<TextFileListResponse>({
      directories: available.map((book) => book.directory),
      filesByDirectory: Object.fromEntries(
        available.map((book) => [book.directory, [book.fileName]])
      ),
      files: available.map(toBookKey),
    });
  }

  const flatFiles: string[] = [];
  directories.forEach(dir => {
    const files = filesByDirectory[dir] || [];
    files.forEach(file => {
      flatFiles.push(toBookKey({ directory: dir, fileName: file }));
    });
  });

  return NextResponse.json<TextFileListResponse>({
    directories,
    filesByDirectory,
    files: flatFiles,
  });
});
