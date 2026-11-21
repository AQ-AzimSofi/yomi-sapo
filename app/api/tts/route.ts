import { NextResponse } from "next/server";
import { TTS_CONFIG, GUEST_KEY_HEADERS } from "@/lib/constants";
import { guestKeyRequired, withAuth } from "@/lib/auth/guards";
import { apiError, parseJsonBody } from "@/lib/api/respond";
import { isNonEmptyString, isOptionalNumber, isRecord } from "@/lib/utils/typeGuards";
import type { TTSRequest, TTSResponse } from "@/lib/types";
import { cleanTextForTTS } from "@/lib/utils/ttsTextCleaner";

const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const TTS_TIMEOUT_MS = 15000;

function isTTSRequest(body: unknown): body is TTSRequest {
  return (
    isRecord(body) &&
    isNonEmptyString(body.text) &&
    isOptionalNumber(body.speed) &&
    (body.voiceGender === undefined || body.voiceGender === 'MALE' || body.voiceGender === 'FEMALE')
  );
}

/**
 * Text-to-Speech APIエンドポイント
 * テキストを受け取り、音声データ(base64)を返す
 * Google Cloud TTS REST APIをAPIキーで直接呼び出す
 */
export const POST = withAuth("viewer", async (request, viewer) => {
  const startTime = Date.now();

  const guestKey = request.headers.get(GUEST_KEY_HEADERS.TTS);
  if (viewer === "guest" && !guestKey) {
    return guestKeyRequired("tts");
  }

  // Guests use their own key; the owner's key is never used for a guest request.
  const apiKey = viewer === "owner" ? process.env.GOOGLE_TTS_API_KEY : guestKey;
  if (!apiKey) {
    return apiError(500, 'not_configured', 'GOOGLE_TTS_API_KEY が設定されていません。');
  }

  const body = await parseJsonBody(request, isTTSRequest, 'テキストが提供されていません');
  if (body instanceof Response) return body;
  const { text, speed = TTS_CONFIG.DEFAULT_SPEED, voiceGender = TTS_CONFIG.DEFAULT_VOICE_GENDER } = body;

  const cleanedText = cleanTextForTTS(text);

  if (!cleanedText) {
    return apiError(400, 'invalid_body', 'テキストが空です');
  }

  console.log(`[${new Date().toISOString()}] TTS リクエスト受信 - 文字数: ${cleanedText.length}, 速度: ${speed}, 音声: ${voiceGender}`);

  const voiceName = voiceGender === 'MALE'
    ? TTS_CONFIG.VOICES.MALE
    : TTS_CONFIG.VOICES.FEMALE;
  const speakingRate = Math.min(TTS_CONFIG.MAX_SPEED, Math.max(TTS_CONFIG.MIN_SPEED, speed));

  try {
    const response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      body: JSON.stringify({
        input: { text: cleanedText },
        voice: {
          languageCode: TTS_CONFIG.LANGUAGE_CODE,
          name: voiceName,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate,
          pitch: 0,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('TTS生成中にエラーが発生しました:', response.status, errorBody);
      return apiError(502, 'upstream_failed', `Google TTS エラー (${response.status})`);
    }

    // REST APIはaudioContentを既にbase64で返すため変換不要
    const data: { audioContent?: string } = await response.json();

    console.log(`[${new Date().toISOString()}] TTS 生成完了。経過時間: ${Date.now() - startTime}ms`);

    const result: TTSResponse = {
      audioContent: data.audioContent ?? '',
      message: '音声を生成しました',
    };

    return NextResponse.json(result);
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (!isTimeout) throw error;
    console.error('TTS生成中にエラーが発生しました:', error);
    return apiError(504, 'upstream_timeout', 'Google TTS がタイムアウトしました');
  }
});
