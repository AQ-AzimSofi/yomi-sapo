import { NextResponse } from "next/server";
import {
  getAIClient,
  ai_instructions_quick,
  ai_instructions_story,
  ai_instructions_nuance,
  ai_instructions_speaker,
  ai_instructions_narrative,
} from "@/lib/ai";
import { AI_MODELS, EXPLANATION_MODES, GUEST_KEY_HEADERS } from "@/lib/constants";
import { guestKeyRequired, withAuth } from "@/lib/auth/guards";
import { parseJsonBody } from "@/lib/api/respond";
import { isNonEmptyString, isOptionalNumber, isOptionalString, isRecord } from "@/lib/utils/typeGuards";
import type { ExplanationResponse } from "@/lib/types";

interface ExplanationBody {
  sentence: string;
  context?: string;
  fileName?: string;
  contextSize?: number;
  mode?: string;
}

function isExplanationBody(body: unknown): body is ExplanationBody {
  return (
    isRecord(body) &&
    isNonEmptyString(body.sentence) &&
    isOptionalString(body.context) &&
    isOptionalString(body.fileName) &&
    isOptionalNumber(body.contextSize) &&
    isOptionalString(body.mode)
  );
}

/**
 * 文の説明を生成するAPIエンドポイント
 * コンテキストを含めて文の意味を日本語で説明
 */
export const POST = withAuth("viewer", async (request, viewer) => {
  const startTime = Date.now();

  const guestKey = request.headers.get(GUEST_KEY_HEADERS.GEMINI);
  if (viewer === "guest" && !guestKey) {
    return guestKeyRequired("gemini");
  }

  const body = await parseJsonBody(request, isExplanationBody, "文が提供されていません");
  if (body instanceof Response) return body;
  const { sentence, context, fileName, contextSize, mode } = body;

  console.log(`[${new Date().toISOString()}] 説明リクエスト受信 - ファイル: ${fileName}, モード: ${mode}, コンテキストサイズ: ${contextSize}. 経過時間: ${Date.now() - startTime}ms`);

  // モードに応じた instruction を選択
  const instructionMap: Record<string, string> = {
    [EXPLANATION_MODES.QUICK]: ai_instructions_quick,
    [EXPLANATION_MODES.STORY]: ai_instructions_story,
    [EXPLANATION_MODES.NUANCE]: ai_instructions_nuance,
    [EXPLANATION_MODES.SPEAKER]: ai_instructions_speaker,
    [EXPLANATION_MODES.NARRATIVE]: ai_instructions_narrative,
  };

  const selectedInstruction = (mode && instructionMap[mode]) || ai_instructions_quick;

  // プロンプトを構築（コンテキスト付き）
  const prompt = context
    ? `${selectedInstruction}

【コンテキスト（前後の文）】
${context}

【説明が必要な文】
${sentence}`
    : `${selectedInstruction}

${sentence}`;

  // Gemini APIを呼び出し (guests use their own key, never the owner's)
  const ai = getAIClient(viewer === "owner" ? undefined : guestKey || undefined);

  const aiCallStartTime = Date.now();
  const response = await ai.models.generateContent({
    model: AI_MODELS.GEMINI_2_5_FLASH_LITE,
    contents: [{ text: prompt }],
  });

  console.log(`[${new Date().toISOString()}] Gemini API レスポンス受信。AI呼び出し時間: ${Date.now() - aiCallStartTime}ms。合計経過時間: ${Date.now() - startTime}ms`);

  const explanation = response.text || '';

  const result: ExplanationResponse = {
    explanation,
    message: '説明を取得しました',
  };

  console.log(`[${new Date().toISOString()}] レスポンスを送信します。合計リクエスト時間: ${Date.now() - startTime}ms`);

  return NextResponse.json(result);
});
