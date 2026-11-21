import { NextResponse } from 'next/server';
import { getVocabularyEntries, createVocabularyEntry } from '@/lib/db/vocabularyQueries.sql';
import { withAuth } from '@/lib/auth/guards';
import { errorBody, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import { isSameSavedWord } from '@/lib/vocabulary/duplicates';
import type { VocabularyEntry } from '@/lib/types';
import type { SaveVocabularyRequest, SaveVocabularyResponse, VocabularyListResponse } from '@/lib/api/contracts';

function isSaveVocabularyRequest(body: unknown): body is SaveVocabularyRequest {
  return (
    isRecord(body) &&
    isNonEmptyString(body.word) &&
    isNonEmptyString(body.sentence) &&
    isNonEmptyString(body.fileName) &&
    isNonEmptyString(body.directory) &&
    isOptionalString(body.reading) &&
    isOptionalString(body.paragraphText) &&
    isOptionalString(body.notes)
  );
}

// The list filter matches the word as a substring; the rule picks the exact entry.
async function findSavedEntry(draft: SaveVocabularyRequest): Promise<VocabularyEntry | undefined> {
  const savedFromBook = await getVocabularyEntries({ word: draft.word, fileName: draft.fileName, directory: draft.directory });
  return savedFromBook.find((saved) => isSameSavedWord(saved, draft));
}

// Guests are never sent here: the vocabulary page is behind the login redirect.
export const GET = withAuth('owner', async (request) => {
  const { searchParams } = new URL(request.url);
  const word = searchParams.get('word') || undefined;
  const fileName = searchParams.get('fileName') || undefined;
  const directory = searchParams.get('directory') || undefined;
  const today = searchParams.get('today') === 'true';

  try {
    const entries = await getVocabularyEntries({
      word,
      fileName,
      directory,
      today,
    });

    return NextResponse.json<VocabularyListResponse>({
      success: true,
      entries,
      count: entries.length,
    });
  } catch (error) {
    // The vocabulary page shows the top-level message.
    console.error('Error fetching vocabulary entries:', error);
    const message = 'Failed to fetch vocabulary entries';
    return NextResponse.json({ ...errorBody('internal_error', message), message }, { status: 500 });
  }
});

export const POST = withAuth('owner', async (request) => {
  const body = await parseJsonBody(
    request,
    isSaveVocabularyRequest,
    'Missing required fields: word, sentence, fileName, directory'
  );
  if (body instanceof Response) return body;

  const savedEntry = await findSavedEntry(body);
  if (savedEntry) {
    return NextResponse.json<SaveVocabularyResponse>({
      success: true,
      message: 'Vocabulary entry already saved',
      entry: savedEntry,
      created: false,
    });
  }

  const { word, reading, sentence, fileName, directory, paragraphText, notes } = body;

  const entry = await createVocabularyEntry({
    word,
    reading,
    sentence,
    fileName,
    directory,
    paragraphText,
    notes,
  });

  return NextResponse.json<SaveVocabularyResponse>({
    success: true,
    message: 'Vocabulary entry created',
    entry,
    created: true,
  });
});
