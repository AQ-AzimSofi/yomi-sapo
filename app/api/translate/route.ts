import { NextResponse } from 'next/server';
import { GUEST_KEY_HEADERS } from '@/lib/constants';
import { guestKeyRequired, withAuth } from '@/lib/auth/guards';
import { apiError, parseJsonBody } from '@/lib/api/respond';
import { isNonEmptyString, isOptionalString, isRecord } from '@/lib/utils/typeGuards';

interface TranslateBody {
  text: string;
  targetLanguage?: string;
}

function isTranslateBody(body: unknown): body is TranslateBody {
  return isRecord(body) && isNonEmptyString(body.text) && isOptionalString(body.targetLanguage);
}

export const POST = withAuth('viewer', async (request, viewer) => {
  const body = await parseJsonBody(request, isTranslateBody, 'Text is required');
  if (body instanceof Response) return body;
  const { text, targetLanguage = 'en' } = body;

  const guestKey = request.headers.get(GUEST_KEY_HEADERS.TRANSLATE);
  if (viewer === 'guest' && !guestKey) {
    return guestKeyRequired('translate');
  }

  // Guests use their own key; the owner's key is never used for a guest request.
  const apiKey = viewer === 'owner' ? process.env.GOOGLE_TRANSLATE_API_KEY : guestKey;
  if (!apiKey) {
    console.error('GOOGLE_TRANSLATE_API_KEY not configured');
    return apiError(500, 'not_configured', 'Translation service not configured');
  }

  // Remove furigana before translation
  // 1. Strip HTML ruby tags: <ruby><rb>漢字</rb><rt>ふりがな</rt></ruby> -> 漢字
  // 2. Strip bracket format: 漢字[ふりがな] -> 漢字
  const cleanedText = text
    .replace(/<rt>[^<]*<\/rt>/g, '')
    .replace(/<\/?(?:ruby|rb|rt)>/g, '')
    .replace(/\[([^\]]+)\]/g, '');

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: cleanedText,
        source: 'ja',
        target: targetLanguage,
        format: 'text',
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    console.error('Google Translate API error:', errorData);
    return apiError(response.status, 'upstream_failed', 'Translation failed');
  }

  const data = await response.json();
  const translatedText = data.data.translations[0].translatedText;

  return NextResponse.json({ translatedText });
});
