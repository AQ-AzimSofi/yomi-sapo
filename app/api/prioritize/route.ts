import { NextResponse } from "next/server";
import { getAIClient } from "@/lib/ai";
import { AI_MODELS, GUEST_KEY_HEADERS, PAGINATION_CONFIG, type PriorityScore } from "@/lib/constants";
import { guestKeyRequired, withAuth } from "@/lib/auth/guards";
import { apiError, parseJsonBody } from "@/lib/api/respond";
import { isRecord } from "@/lib/utils/typeGuards";
import type { PrioritizeResponse } from "@/lib/api/contracts";

export const dynamic = "force-dynamic";

// A reader page holds at most one screen of units, so this also bounds how many
// sentences we ever score. Derived from the reader's paging so the two stay in
// step -- raising items-per-page can never silently drop sentences here.
const MAX_SENTENCES = PAGINATION_CONFIG.ITEMS_PER_PAGE;

const RATING_INSTRUCTION = `Act as an expert reading comprehension assistant. Below are numbered sentences from one page of a book. Rate the importance of EACH sentence on a scale of 1 to 5.

[5] Critical: the core thesis, a major plot point, or vital information the page loses its meaning without.
[4] High: strong supporting arguments, essential character development, or highly relevant context.
[3] Moderate: standard narrative, dialogue, or transitional information.
[2] Low: minor descriptive details, tangents, or repetitive supporting points.
[1] Filler: purely atmospheric, fluff, or highly skimmable text.

Respond with ONLY a JSON object of the form {"scores":[n1,n2,...]} where the array holds exactly one integer (1-5) per numbered sentence, in the same order. Output no sentences, no rationale, no other text.`;

// Each sentence is coerced with String(), so only the array itself is checked.
interface PrioritizeBody {
  sentences: unknown[];
}

function isPrioritizeBody(body: unknown): body is PrioritizeBody {
  return isRecord(body) && Array.isArray(body.sentences) && body.sentences.length > 0;
}

function clampScore(value: unknown): PriorityScore {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return 3;
  return Math.min(5, Math.max(1, rounded)) as PriorityScore;
}

export const POST = withAuth("viewer", async (request, viewer) => {
  const guestKey = request.headers.get(GUEST_KEY_HEADERS.GEMINI);
  if (viewer === "guest" && !guestKey) {
    return guestKeyRequired("gemini");
  }

  const body = await parseJsonBody(request, isPrioritizeBody, "No sentences provided");
  if (body instanceof Response) return body;

  const trimmed = body.sentences.slice(0, MAX_SENTENCES).map((s) => String(s));
  const numbered = trimmed.map((sentence, index) => `${index + 1}. ${sentence}`).join("\n");
  const prompt = `${RATING_INSTRUCTION}\n\nSentences:\n${numbered}`;

  const ai = getAIClient(viewer === "owner" ? undefined : guestKey || undefined);
  const response = await ai.models.generateContent({
    model: AI_MODELS.GEMINI_3_5_FLASH,
    contents: [{ text: prompt }],
    config: { responseMimeType: "application/json" },
  });

  const parsed = JSON.parse(response.text || "{}");
  const rawScores = Array.isArray(parsed) ? parsed : parsed?.scores;

  // A blocked/empty candidate or count mismatch must fail loudly rather than be
  // coerced into uniform defaults the reader would show as real judgment.
  if (!Array.isArray(rawScores) || rawScores.length !== trimmed.length) {
    return apiError(502, "upstream_failed", "The model did not return a score for every sentence.");
  }

  return NextResponse.json<PrioritizeResponse>({ scores: rawScores.map(clampScore) });
});
