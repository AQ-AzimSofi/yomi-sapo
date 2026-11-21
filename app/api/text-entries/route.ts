/**
 * Copies a book file from the local public/ folder into text_entries.
 * The book pipeline calls this on the local dev server.
 */

import { NextResponse } from 'next/server';
import { upsertTextEntry } from '@/lib/db/queries';
import { readTextFile } from '@/lib/services/fileService';
import { normalizeNewlines } from '@/lib/content/bookModel';

// Mark as dynamic to prevent static generation during build
export const dynamic = 'force-dynamic';

/**
 * PUT /api/text-entries
 * Update/re-migrate specific file from filesystem to database
 * Body: { fileName: string, directory: string }
 *
 * Only the local dev server has the book files under public/, and the book
 * pipeline calls this there without credentials, so production never serves it.
 */
export async function PUT(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  }

  if (request.headers.get('content-type') !== 'application/json') {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid Content-Type'
      },
      { status: 400 }
    );
  }

  try {
    const { fileName, directory } = await request.json();

    if (!fileName || !directory) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required fields: fileName and directory'
        },
        { status: 400 }
      );
    }

    // Validation (prevent directory traversal attacks)
    if (fileName.includes('..') || directory.includes('..')) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid file name or directory'
        },
        { status: 400 }
      );
    }

    // Read file from filesystem
    const filePath = `${directory}/${fileName}`;
    const content = normalizeNewlines(await readTextFile(filePath));

    if (!content) {
      return NextResponse.json(
        {
          success: false,
          message: `File not found or empty: ${filePath}`
        },
        { status: 404 }
      );
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
  } catch (error) {
    console.error('Error updating text entry:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to update text entry',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
