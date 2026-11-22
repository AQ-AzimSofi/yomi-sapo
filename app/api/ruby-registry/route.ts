import { NextResponse } from 'next/server';
import { getRubyRegistry, hideRubyRegistryItem, saveRubyRegistryEntry } from '@/lib/db/rubyRegistryQueries.sql';
import { isUndefinedTable } from '@/lib/db/errorCode';
import { guestPreviewOnly, withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import { isPublicDirectory } from '@/lib/publicBooks';
import { isSafeBookRef } from '@/lib/books/bookRef';
import { isRubyEntrySource } from '@/lib/rubyEntrySource';
import type {
  ApiErrorBody,
  RubyEntryDraft,
  RubyRegistryItemType,
  RubyRegistryKey,
  RubyRegistryResponse,
  SaveRubyEntryRequest,
} from '@/lib/api/contracts';

export const dynamic = 'force-dynamic';

function isRubyEntryDraft(entry: unknown): entry is RubyEntryDraft {
  return (
    isRecord(entry) &&
    isNonEmptyString(entry.kanji) &&
    isNonEmptyString(entry.reading) &&
    (entry.source === undefined || isRubyEntrySource(entry.source)) &&
    isOptionalString(entry.note)
  );
}

// A registry is keyed by the book's folder, so the key must stay inside the book folders the same
// way a book does.
function isSafeRegistryKey(key: RubyRegistryKey): boolean {
  return isSafeBookRef({ directory: key.directory, fileName: key.bookName });
}

function isRubyEntryRequest(body: unknown): body is SaveRubyEntryRequest {
  return (
    isRecord(body) &&
    isNonEmptyString(body.directory) &&
    isNonEmptyString(body.bookName) &&
    isRubyEntryDraft(body.entry)
  );
}

function registryUnavailable(): NextResponse<ApiErrorBody> {
  return apiError(503, 'registry_unavailable', 'The ruby registry is not available on this server yet');
}

// Production on Neon has no ruby_registry_entries table until the move to Aurora DSQL, so a query
// there fails with undefined_table. Only that becomes 503; any other failure stays a 500.
async function withRegistryTable(answer: () => Promise<Response>): Promise<Response> {
  try {
    return await answer();
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    return registryUnavailable();
  }
}

async function registryResponse(key: RubyRegistryKey, message: string): Promise<NextResponse<RubyRegistryResponse>> {
  return NextResponse.json<RubyRegistryResponse>({ success: true, registry: await getRubyRegistry(key), message });
}

export const GET = withAuth('viewer', async (request, viewer) => {
  const { searchParams } = new URL(request.url);
  const directory = searchParams.get('directory');
  const bookName = searchParams.get('bookName');

  if (!directory || !bookName) {
    return apiError(400, 'invalid_request', 'directory and bookName are required');
  }
  const key = { directory, bookName };
  if (!isSafeRegistryKey(key)) {
    return apiError(400, 'invalid_request', 'Invalid path');
  }

  // Guests may read the vocabulary index of an allowlisted preview book. This is
  // the whole-book ruby registry (a kanji->reading index), intentionally not
  // capped to the 5-page text preview -- it is derived metadata, not prose.
  if (viewer === 'guest' && !isPublicDirectory(`${directory}/${bookName}`)) {
    return guestPreviewOnly();
  }

  return withRegistryTable(() => registryResponse(key, 'Registry loaded'));
});

export const POST = withAuth('owner', async (request) => {
  const body = await parseJsonBody(
    request,
    isRubyEntryRequest,
    'directory, bookName, and an entry with kanji and reading are required'
  );
  if (body instanceof Response) return body;
  const { directory, bookName, entry } = body;
  const key = { directory, bookName };
  if (!isSafeRegistryKey(key)) {
    return apiError(400, 'invalid_request', 'Invalid path');
  }

  return withRegistryTable(async () => {
    await saveRubyRegistryEntry(key, {
      kanji: entry.kanji,
      reading: entry.reading,
      source: entry.source || 'user',
      note: entry.note || '',
    });
    return registryResponse(key, 'Entry saved');
  });
});

export const DELETE = withAuth('owner', async (request) => {
  const { searchParams } = new URL(request.url);
  const directory = searchParams.get('directory');
  const bookName = searchParams.get('bookName');
  const kanji = searchParams.get('kanji');
  const type: RubyRegistryItemType = searchParams.get('type') === 'suggestion' ? 'suggestion' : 'entry';

  if (!directory || !bookName || !kanji) {
    return apiError(400, 'invalid_request', 'directory, bookName, and kanji are required');
  }
  const key = { directory, bookName };
  if (!isSafeRegistryKey(key)) {
    return apiError(400, 'invalid_request', 'Invalid path');
  }

  return withRegistryTable(async () => {
    await hideRubyRegistryItem(key, kanji, type);
    return registryResponse(key, type === 'suggestion' ? 'Suggestion ignored' : 'Entry deleted');
  });
});
