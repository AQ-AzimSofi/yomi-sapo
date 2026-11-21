import { ApiError } from '@/lib/api/client';
import { buildExplanationContext, type SentenceSurroundings } from '@/lib/content/explanationContext';
import { shareRequest } from '@/lib/utils/shareRequest';
import type { ExplanationAnswer, ExplanationCacheQuery } from '@/app/hooks/useExplanationCache';
import type { ExplanationRequest, ExplanationResponse } from '@/lib/api/contracts';
import type { ExplanationMode } from '@/lib/constants';
import type { CachedExplanation } from '@/lib/types';
import type { ExplanationEvent } from './explanationDisplay';

/** What the reader wants explained, with the settings it is explained under. */
export interface ExplanationTarget {
  fileName: string;
  sentence: string;
  surroundings: SentenceSurroundings;
  contextSize: number;
  mode: ExplanationMode;
}

export interface ExplanationAsker {
  getCache: (query: ExplanationCacheQuery) => CachedExplanation | null;
  setCache: (answer: ExplanationAnswer) => void;
  explain: (request: ExplanationRequest) => Promise<ExplanationResponse>;
  dispatch: (event: ExplanationEvent) => void;
  nextRequestId: () => number;
  // Requests still out, keyed by what they ask, so an identical ask joins one.
  pending: Map<string, Promise<string>>;
}

export function describeExplanationFailure(error: unknown): string {
  if (error instanceof ApiError && error.promptedGuestKey) {
    return 'Guest mode: add or update your Gemini API key to use AI explanations.';
  }
  if (error instanceof ApiError) return `Failed to fetch explanation: ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

/**
 * Shows the saved answer for the target, or asks the AI. Every request gets its
 * own id, and the display only takes the answer or failure of the latest one. A
 * late answer for an earlier sentence, mode or context size is still cached under
 * its own key; the request is never aborted, because the server would pay for the
 * AI call anyway.
 */
export function askForExplanation(
  asker: ExplanationAsker,
  target: ExplanationTarget,
  { bypassCache }: { bypassCache: boolean }
): void {
  const { fileName, sentence, surroundings, contextSize, mode } = target;
  const context = buildExplanationContext({ sentence, surroundings, contextSize });
  const cached = bypassCache ? null : asker.getCache({ fileName, sentence, mode, contextSize, context });
  if (cached) {
    asker.dispatch({ type: 'cacheHit', text: cached.explanation, cachedAt: cached.timestamp });
    return;
  }

  const requestId = asker.nextRequestId();
  asker.dispatch({ type: 'requested', requestId });

  const request: ExplanationRequest = { sentence, context, fileName, contextSize, mode };
  const answer = shareRequest(asker.pending, JSON.stringify(request), async () => {
    const requestedAt = Date.now();
    const { explanation } = await asker.explain(request);
    asker.setCache({ fileName, sentence, mode, contextSize, context, explanation, requestedAt });
    return explanation;
  });
  answer.then(
    (text) => asker.dispatch({ type: 'answered', requestId, text }),
    (error: unknown) => asker.dispatch({ type: 'failed', requestId, message: describeExplanationFailure(error) })
  );
}
