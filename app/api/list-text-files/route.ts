import { NextResponse } from 'next/server';
import { getAllTextEntries } from '@/lib/db/queries';
import { withAuth } from '@/lib/auth/guards';
import { PUBLIC_BOOKS } from '@/lib/publicBooks';

export const dynamic = 'force-dynamic';

export const GET = withAuth('viewer', async (request, viewer) => {
  const { directories, filesByDirectory } = await getAllTextEntries();

  if (viewer === 'guest') {
    const available = PUBLIC_BOOKS.filter((book) =>
      (filesByDirectory[book.directory] || []).includes(book.fileName)
    );
    return NextResponse.json({
      directories: available.map((book) => book.directory),
      filesByDirectory: Object.fromEntries(
        available.map((book) => [book.directory, [book.fileName]])
      ),
      files: available.map((book) => `${book.directory}/${book.fileName}`),
    });
  }

  const flatFiles: string[] = [];
  directories.forEach(dir => {
    const files = filesByDirectory[dir] || [];
    files.forEach(file => {
      flatFiles.push(`${dir}/${file}`);
    });
  });

  return NextResponse.json({
    directories,
    filesByDirectory,
    files: flatFiles,
  });
});
