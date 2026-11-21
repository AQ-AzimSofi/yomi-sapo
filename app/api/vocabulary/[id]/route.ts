import { NextResponse } from 'next/server';
import {
  getVocabularyEntryById,
  updateVocabularyEntry,
  deleteVocabularyEntry,
} from '@/lib/db/vocabularyQueries.sql';
import { isAuthenticated } from '@/lib/auth/apiSession';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function rejectGuest(): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;
  return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: Request, { params }: RouteParams) {
  const rejection = await rejectGuest();
  if (rejection) return rejection;

  try {
    const { id } = await params;
    const entry = await getVocabularyEntryById(id);

    if (!entry) {
      return NextResponse.json(
        { success: false, message: 'Vocabulary entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      entry,
    });
  } catch (error) {
    console.error('Error fetching vocabulary entry:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch vocabulary entry' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const rejection = await rejectGuest();
  if (rejection) return rejection;

  try {
    const { id } = await params;
    const body = await request.json();
    const { notes, word, reading } = body;

    const entry = await updateVocabularyEntry(id, { notes, word, reading });

    if (!entry) {
      return NextResponse.json(
        { success: false, message: 'Vocabulary entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Vocabulary entry updated',
      entry,
    });
  } catch (error) {
    console.error('Error updating vocabulary entry:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update vocabulary entry' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const rejection = await rejectGuest();
  if (rejection) return rejection;

  try {
    const { id } = await params;
    await deleteVocabularyEntry(id);

    return NextResponse.json({
      success: true,
      message: 'Vocabulary entry deleted',
    });
  } catch (error) {
    console.error('Error deleting vocabulary entry:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete vocabulary entry' },
      { status: 500 }
    );
  }
}
