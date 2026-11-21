import { NextResponse } from 'next/server';
import {
  readRubyRegistry,
  upsertRubyEntry,
  deleteRubyEntry,
  ignoreSuggestion
} from '@/lib/services/fileService';
import { guestPreviewOnly, withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import { isPublicDirectory } from '@/lib/publicBooks';
import { isSafeBookRef } from '@/lib/books/bookRef';
import type { RubyEntry } from '@/lib/types';
import type { RubyRegistryResponse } from '@/lib/api/contracts';

export const dynamic = 'force-dynamic';

interface RubyEntryDraft {
  kanji: string;
  reading: string;
  source?: RubyEntry['source'];
  note?: string;
}

interface RubyEntryRequest {
  directory: string;
  bookName: string;
  entry: RubyEntryDraft;
}

function isRubyEntryDraft(entry: unknown): entry is RubyEntryDraft {
  return (
    isRecord(entry) &&
    isNonEmptyString(entry.kanji) &&
    isNonEmptyString(entry.reading) &&
    (entry.source === undefined || entry.source === 'epub' || entry.source === 'user') &&
    isOptionalString(entry.note)
  );
}

// A registry lives in the book folder public/<directory>/<bookName>, so it must stay
// inside the book folders the same way a book does.
function isSafeRegistryKey(directory: string, bookName: string): boolean {
  return isSafeBookRef({ directory, fileName: bookName });
}

function isRubyEntryRequest(body: unknown): body is RubyEntryRequest {
  return (
    isRecord(body) &&
    isNonEmptyString(body.directory) &&
    isNonEmptyString(body.bookName) &&
    isRubyEntryDraft(body.entry)
  );
}

export const GET = withAuth('viewer', async (request, viewer) => {
  const { searchParams } = new URL(request.url);
  const directory = searchParams.get('directory');
  const bookName = searchParams.get('bookName');

  if (!directory || !bookName) {
    return apiError(400, 'invalid_request', 'directory and bookName are required');
  }

  if (!isSafeRegistryKey(directory, bookName)) {
    return apiError(400, 'invalid_request', 'Invalid path');
  }

  // Guests may read the vocabulary index of an allowlisted preview book. This is
  // the whole-book ruby registry (a kanji->reading index), intentionally not
  // capped to the 5-page text preview -- it is derived metadata, not prose.
  if (viewer === 'guest' && !isPublicDirectory(`${directory}/${bookName}`)) {
    return guestPreviewOnly();
  }

  const registry = await readRubyRegistry(directory, bookName);
  if (!registry) {
    return NextResponse.json<RubyRegistryResponse>({
      success: true,
      registry: {
        bookTitle: bookName,
        entries: [],
        suggestions: []
      },
      message: 'No registry found, returning empty'
    });
  }

  return NextResponse.json<RubyRegistryResponse>({
    success: true,
    registry,
    message: 'Registry loaded'
  });
});

export const POST = withAuth('owner', async (request) => {
  const body = await parseJsonBody(
    request,
    isRubyEntryRequest,
    'directory, bookName, and an entry with kanji and reading are required'
  );
  if (body instanceof Response) return body;
  const { directory, bookName, entry } = body;
  if (!isSafeRegistryKey(directory, bookName)) {
    return apiError(400, 'invalid_request', 'Invalid path');
  }

  const registry = await upsertRubyEntry(directory, bookName, {
    kanji: entry.kanji,
    reading: entry.reading,
    source: entry.source || 'user',
    note: entry.note || ''
  });

  return NextResponse.json<RubyRegistryResponse>({
    success: true,
    registry,
    message: 'Entry saved'
  });
});

export const DELETE = withAuth('owner', async (request) => {
  const { searchParams } = new URL(request.url);
  const directory = searchParams.get('directory');
  const bookName = searchParams.get('bookName');
  const kanji = searchParams.get('kanji');
  const type = searchParams.get('type') || 'entry';

  if (!directory || !bookName || !kanji) {
    return apiError(400, 'invalid_request', 'directory, bookName, and kanji are required');
  }
  if (!isSafeRegistryKey(directory, bookName)) {
    return apiError(400, 'invalid_request', 'Invalid path');
  }

  const registry = type === 'suggestion'
    ? await ignoreSuggestion(directory, bookName, kanji)
    : await deleteRubyEntry(directory, bookName, kanji);

  if (!registry) {
    return apiError(404, 'not_found', 'Registry not found');
  }

  return NextResponse.json<RubyRegistryResponse>({
    success: true,
    registry,
    message: type === 'suggestion' ? 'Suggestion ignored' : 'Entry deleted'
  });
});
