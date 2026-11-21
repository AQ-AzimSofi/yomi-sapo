import { NextResponse } from 'next/server';
import { getVocabularyEntries, createVocabularyEntry } from '@/lib/db/vocabularyQueries.sql';
import { withAuth } from '@/lib/auth/guards';
import { errorBody, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import type { VocabularyEntryResponse, VocabularyListResponse } from '@/lib/types';

interface VocabularyDraft {
  word: string;
  reading?: string;
  sentence: string;
  fileName: string;
  directory: string;
  paragraphText?: string;
  notes?: string;
}

function isVocabularyDraft(body: unknown): body is VocabularyDraft {
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
    isVocabularyDraft,
    'Missing required fields: word, sentence, fileName, directory'
  );
  if (body instanceof Response) return body;
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

  return NextResponse.json<VocabularyEntryResponse>({
    success: true,
    message: 'Vocabulary entry created',
    entry,
  });
});
