import { NextResponse } from 'next/server';
import {
  getVocabularyEntryById,
  updateVocabularyEntry,
  deleteVocabularyEntry,
} from '@/lib/db/vocabularyQueries.sql';
import { withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isOptionalString, isRecord } from '@/lib/utils/typeGuards';
import type { VocabularyEntryResponse } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface VocabularyEdit {
  notes?: string;
  word?: string;
  reading?: string;
}

function isVocabularyEdit(body: unknown): body is VocabularyEdit {
  return isRecord(body) && isOptionalString(body.notes) && isOptionalString(body.word) && isOptionalString(body.reading);
}

export const GET = withAuth('owner', async (request: Request, { params }: RouteParams) => {
  const { id } = await params;
  const entry = await getVocabularyEntryById(id);

  if (!entry) {
    return apiError(404, 'not_found', 'Vocabulary entry not found');
  }

  return NextResponse.json<VocabularyEntryResponse>({
    success: true,
    entry,
  });
});

export const PUT = withAuth('owner', async (request: Request, { params }: RouteParams) => {
  const { id } = await params;
  const body = await parseJsonBody(request, isVocabularyEdit, 'notes, word and reading must be strings when present');
  if (body instanceof Response) return body;
  const { notes, word, reading } = body;

  const entry = await updateVocabularyEntry(id, { notes, word, reading });

  if (!entry) {
    return apiError(404, 'not_found', 'Vocabulary entry not found');
  }

  return NextResponse.json<VocabularyEntryResponse>({
    success: true,
    message: 'Vocabulary entry updated',
    entry,
  });
});

export const DELETE = withAuth('owner', async (request: Request, { params }: RouteParams) => {
  const { id } = await params;
  await deleteVocabularyEntry(id);

  return NextResponse.json({
    success: true,
    message: 'Vocabulary entry deleted',
  });
});
