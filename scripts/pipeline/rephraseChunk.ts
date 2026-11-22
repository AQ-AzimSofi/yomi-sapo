import { setTimeout as sleep } from 'node:timers/promises';
import { AI_MODELS, VN_RETRY_CONFIG } from '../../lib/constants';
import { rephraseWithClaude, splitParagraphs } from '../utils/claude-rephrase';
import { stripRubyTags } from './chunking';
import { findFormatProblem, sanitizeRephraseResponse, type SanitizedRephrase } from './rephraseFormat';
import {
  describeError,
  describeUnusableKey,
  isRateLimited,
  isRetryable,
  isUnknownModel,
  PAID_API_KEY_ENV_NAME,
  pickKey,
  readRetryDelaySecs,
  retireKey,
  type ApiKey,
  type KeyPool,
} from '../shared/geminiKeyPool';

// Model fallback order: try gemini-3-flash-preview first, then 2.5-flash, then 2.5-flash-lite
const MODEL_FALLBACK_ORDER = [
  AI_MODELS.GEMINI_3_FLASH_PREVIEW,
  AI_MODELS.GEMINI_2_5_FLASH,
  AI_MODELS.GEMINI_2_5_FLASH_LITE,
];

const ai_instructions = `
以下の文章について、日本語学習者が意味を掴みやすくするために、元の一行ごとに要約してください。回答は必ず下記の構成に従ってください。

<（原文）
>>元の文のメッセージを要約してください。

一行ずつ、このフォーマットを繰り返してください。

例：
< かつて１０００年の都と謳われた古都のはずれに、世界はどこまでもシンプルであり、人は今日からでも幸せになれる、と説く哲学者が住んでいた。
>> 古都のはずれに、「世界はシンプルで人は幸せになれる」と説く哲学者が住んでいた。

< 納得のいかない青年は、哲学者のもとを訪ね、その真意を問いただそうとしていた。
>> その教えに納得できない青年が、哲学者の本当の考えを聞きに行った。

< 悩み多き彼の目には、世界は矛盾に満ちた混沌としか映らず、ましてや幸福などありえなかった。
>> 悩みの多い青年には、世界は複雑で、幸せになれるとは思えなかった。

---
それでは、以下の文章でお願いします：
`;

function logRephraseCheck(sanitized: SanitizedRephrase): void {
  const { alignment } = sanitized;
  const summary = [
    `${sanitized.metaLines.length} meta and ${sanitized.contentLines.length} other stray line(s) dropped`,
    `${alignment.restoredHeadCount} original(s) restored`,
    `${alignment.insertedPassages.length} skipped passage(s) put back`,
    `${alignment.unmatchedHeads.length} unmatched`,
  ].join(', ');
  console.log(`  Output check: ${summary}`);
  sanitized.contentLines.forEach((line) => console.log(`    - ${line.slice(0, 60)}`));
  alignment.insertedPassages.forEach((passage) => console.log(`    + ${passage.slice(0, 60)}`));
  alignment.unmatchedHeads.forEach((head) => console.log(`    ? ${head.slice(0, 60)}`));
  sanitized.missingImageMarkers.forEach((marker) => console.log(`    ! image marker lost: ${marker}`));
  sanitized.readerMismatches.forEach((mismatch) => console.log(`    ! the reader reads this differently: ${mismatch}`));
}

export const FALLBACK_ERROR = 'Used original text (rephrase failed)';
const RESUME_HINT = 'Progress is saved. Run the same command again to resume from this chunk.';
const CORRECTION_PREFIX = '回答のフォーマットが正しくありません。もう一度やり直してください。必ず下記の構成に従ってください。\n';
const MAX_RETRY_WAIT_SECS = 30;
const FIRST_RATE_LIMIT_WAIT_SECS = 10;
const MAX_RATE_LIMIT_WAIT_SECS = 120;
// A per-minute limit clears within a minute, so this many waits ride out several in a row
// before the attempt counts as failed.
const MAX_RATE_LIMIT_WAITS = 6;

export interface ChunkOutput {
  rawText: string;
  readerText: string;
  attempts: number;
  /** The rephrase failed and every line stands in as its own rephrase; the next run retries the chunk. */
  isFallback: boolean;
  error?: string;
}

export interface ChunkRequest {
  chunkIndex: number;
  /** Below maxConcurrency; a Gemini worker starts each chunk on its own key. */
  workerIndex: number;
  /** Ctrl+C: ends the request in flight and every wait at once; the chunk stays unsaved. */
  signal: AbortSignal;
}

export interface ChunkRephraser {
  /** How many chunks may run at once. */
  maxConcurrency: number;
  rephraseChunk: (chunk: string, request: ChunkRequest) => Promise<ChunkOutput>;
}

export interface GeminiSettings {
  model: string;
  /** --delay: the least seconds between two requests on the same key; 0 leaves the pace to the rate limits. */
  delaySeconds: number;
}

/** Resolves once the key may take another request. */
type WaitForKey = (key: ApiKey, signal: AbortSignal) => Promise<void>;

interface ModelRequest extends ChunkRequest {
  model: string;
  keyPool: KeyPool;
  cleanChunk: string;
  waitForKey: WaitForKey;
}

interface ModelAttempt {
  attempt: number;
  instruction: string;
  /** Rate-limit waits so far for this chunk; up to MAX_RATE_LIMIT_WAITS they use up no attempt. */
  rateLimitWaits: number;
}

interface RequestFailure {
  key: ApiKey;
  error: unknown;
}

// out-of-keys and model-unavailable stop the run rather than save original text for every chunk that follows.
type ModelResult =
  | { outcome: 'rephrased'; response: string; requestCount: number }
  | { outcome: 'attempts-used-up'; requestCount: number }
  | { outcome: 'out-of-keys'; requestCount: number }
  | { outcome: 'model-unavailable'; requestCount: number };

/** Each request reserves its key's next slot before waiting for it, so requests that share a key queue up. */
function createKeyPacer(minSpacingMs: number): WaitForKey {
  const nextFreeAtMsByKey = new Map<string, number>();
  return async (key, signal) => {
    const nowMs = Date.now();
    const startAtMs = Math.max(nowMs, nextFreeAtMsByKey.get(key.envName) ?? nowMs);
    nextFreeAtMsByKey.set(key.envName, startAtMs + minSpacingMs);
    if (startAtMs > nowMs) await sleep(startAtMs - nowMs, undefined, { signal });
  };
}

async function generateText(key: ApiKey, prompt: string, request: ModelRequest): Promise<string> {
  const response = await key.client.models.generateContent({ model: request.model, contents: prompt, config: { abortSignal: request.signal } });
  return response.text || '';
}

// Each attempt moves to the next free key, so one key's transient errors do not sink the chunk.
// The first attempt uses the worker's own key, so workers on different keys never share one.
async function requestWithModel(request: ModelRequest, current: ModelAttempt): Promise<ModelResult> {
  const { keyPool } = request;
  const maxAttempts = VN_RETRY_CONFIG.MAX_ATTEMPTS;
  const requestCount = current.attempt - 1;
  if (current.attempt > maxAttempts) return { outcome: 'attempts-used-up', requestCount };
  const key = pickKey(keyPool, request.workerIndex + current.attempt - 1);
  if (!key) return { outcome: 'out-of-keys', requestCount };

  await request.waitForKey(key, request.signal);
  console.log(`    Chunk ${request.chunkIndex + 1}, attempt ${current.attempt}/${maxAttempts} (${key.envName})...`);
  const outcome = await generateText(key, current.instruction + request.cleanChunk, request).then(
    (text) => ({ text, error: undefined }),
    (error: unknown) => ({ text: undefined, error }),
  );
  if (outcome.text !== undefined) {
    const formatProblem = findFormatProblem(outcome.text);
    if (!formatProblem) return { outcome: 'rephrased', response: outcome.text, requestCount: current.attempt };
    console.log(`    Invalid format (${formatProblem}), retrying with correction prompt...`);
    console.log('    Response preview:', outcome.text.slice(0, 200).replace(/\n/g, '\\n'));
    return requestWithModel(request, { ...current, attempt: current.attempt + 1, instruction: CORRECTION_PREFIX + ai_instructions });
  }
  return retryAfterError(request, current, { key, error: outcome.error });
}

// The same attempt goes again on the same key: the limit is that key's, and moving on would only
// take another worker's key.
async function waitOutRateLimit(request: ModelRequest, current: ModelAttempt, { key, error }: RequestFailure): Promise<ModelResult> {
  const backoffSecs = FIRST_RATE_LIMIT_WAIT_SECS * 2 ** current.rateLimitWaits;
  const waitSecs = Math.min(MAX_RATE_LIMIT_WAIT_SECS, readRetryDelaySecs(error) ?? backoffSecs);
  console.log(`    ${key.envName} is rate limited; trying it again in ${waitSecs}s...`);
  await sleep(waitSecs * 1000, undefined, { signal: request.signal });
  return requestWithModel(request, { ...current, rateLimitWaits: current.rateLimitWaits + 1 });
}

async function retryAfterError(request: ModelRequest, current: ModelAttempt, failure: RequestFailure): Promise<ModelResult> {
  const { model, keyPool } = request;
  const { key, error } = failure;
  const maxAttempts = VN_RETRY_CONFIG.MAX_ATTEMPTS;
  request.signal.throwIfAborted();
  console.error(`    API error on attempt ${current.attempt}:`, describeError(error));
  const isFreeKey = key !== keyPool.paidKey;
  const unusableKeyReason = describeUnusableKey(error, model);
  // A retired key does not use up an attempt: the next key gets the same one.
  if (unusableKeyReason && isFreeKey) {
    retireKey(keyPool, key, unusableKeyReason);
    return requestWithModel(request, current);
  }
  if (unusableKeyReason) return { outcome: 'out-of-keys', requestCount: current.attempt };
  if (isUnknownModel(error)) {
    console.log(`    Model ${model} unavailable, trying next fallback...`);
    return { outcome: 'model-unavailable', requestCount: current.attempt };
  }
  if (isRateLimited(error) && current.rateLimitWaits < MAX_RATE_LIMIT_WAITS) return waitOutRateLimit(request, current, failure);
  if (!isRetryable(error) || current.attempt >= maxAttempts) {
    return { outcome: 'attempts-used-up', requestCount: current.attempt };
  }
  const waitSecs = Math.min(MAX_RETRY_WAIT_SECS, current.attempt * 10);
  console.log(`    Waiting ${waitSecs}s before retry...`);
  await sleep(waitSecs * 1000, undefined, { signal: request.signal });
  return requestWithModel(request, { ...current, attempt: current.attempt + 1 });
}

function listModelsToTry(model: string): string[] {
  return [model, ...MODEL_FALLBACK_ORDER.filter((fallbackModel) => fallbackModel !== model)];
}

// Each line stands in as its own rephrase so no content is skipped
function createFallbackOutput(cleanChunk: string, requestCount: number): ChunkOutput {
  console.log(`  Failed after ${requestCount} attempts, using original text as fallback...`);
  const lines = cleanChunk.split('\n').filter(l => l.trim().length > 0);
  const fallbackResponse = lines.map(line => `< ${line}\n>> ${line}`).join('\n\n');
  return {
    rawText: fallbackResponse,
    readerText: fallbackResponse,
    attempts: requestCount,
    isFallback: true,
    error: FALLBACK_ERROR,
  };
}

/**
 * Free keys first, then GEMINI_API_KEY_PAID on the same model. A key out of daily quota hands the
 * request to the next key. A per-minute limit (429) waits as long as Gemini asks, or backs off, and
 * retries on the same key without using up an attempt; a server error waits and retries on the
 * next key. Only an unknown model moves on to the next model in the fallback order. Daily quotas
 * are per model, so every model keeps its own pool of retired keys.
 */
export function createGeminiRephraser({ model, delaySeconds }: GeminiSettings, createPool: () => KeyPool): ChunkRephraser {
  const poolsByModel = new Map<string, KeyPool>();
  const getPool = (poolModel: string): KeyPool => {
    const existingPool = poolsByModel.get(poolModel);
    if (existingPool) return existingPool;
    const newPool = createPool();
    poolsByModel.set(poolModel, newPool);
    return newPool;
  };
  const requestedModelPool = getPool(model);
  const waitForKey = createKeyPacer(delaySeconds * 1000);

  const rephraseChunk = async (chunk: string, chunkRequest: ChunkRequest): Promise<ChunkOutput> => {
    const cleanChunk = stripRubyTags(chunk);
    const result = await listModelsToTry(model).reduce<Promise<ModelResult & { usedModel: string }>>(
      async (previous, currentModel) => {
        const earlier = await previous;
        if (earlier.outcome !== 'model-unavailable') return earlier;
        console.log(`    Trying model: ${currentModel}`);
        const request = { ...chunkRequest, model: currentModel, keyPool: getPool(currentModel), cleanChunk, waitForKey };
        const modelResult = await requestWithModel(request, { attempt: 1, instruction: ai_instructions, rateLimitWaits: 0 });
        return { ...modelResult, requestCount: earlier.requestCount + modelResult.requestCount, usedModel: currentModel };
      },
      Promise.resolve({ outcome: 'model-unavailable', requestCount: 0, usedModel: model }),
    );

    if (result.outcome === 'out-of-keys') {
      throw new Error(`No Gemini key has quota left for ${result.usedModel} today (the free keys, then ${PAID_API_KEY_ENV_NAME}).\n${RESUME_HINT}`);
    }
    if (result.outcome === 'model-unavailable') {
      throw new Error(`No Gemini model could be reached (${listModelsToTry(model).join(', ')}).\n${RESUME_HINT}`);
    }
    if (result.outcome === 'attempts-used-up') return createFallbackOutput(cleanChunk, result.requestCount);

    if (result.usedModel !== model) console.log(`    Success with fallback model: ${result.usedModel}`);
    const sanitized = sanitizeRephraseResponse(cleanChunk, result.response);
    logRephraseCheck(sanitized);
    return { rawText: result.response, readerText: sanitized.text, attempts: result.requestCount, isFallback: false };
  };

  // One worker per free key; with only the paid key, one at a time.
  return { maxConcurrency: Math.max(requestedModelPool.freeKeys.length, 1), rephraseChunk };
}

// A failed claude -p call (usage limit, sign-in) stops the run; this chunk stays unfinished, so rerunning resumes it.
async function rephraseChunkWithClaude(chunk: string, model: string, signal: AbortSignal): Promise<ChunkOutput> {
  const rephrased = await rephraseWithClaude(splitParagraphs(stripRubyTags(chunk)), model, signal).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\n${RESUME_HINT}`, { cause: error });
  });
  const skippedCount = rephrased.skippedParagraphs.length;
  rephrased.skippedParagraphs.forEach((paragraph) => console.log(`    ? kept original: ${paragraph.slice(0, 60)}`));
  return {
    rawText: rephrased.text,
    readerText: rephrased.text,
    attempts: rephrased.attempts,
    isFallback: false,
    error: skippedCount > 0 ? `${skippedCount} paragraph(s) kept their original text` : undefined,
  };
}

// One claude -p at a time: the subscription's usage limit is per account, so parallel calls would
// only reach it sooner, and nothing shows that parallel headless sessions are safe on it.
export function createClaudeRephraser(model: string): ChunkRephraser {
  return { maxConcurrency: 1, rephraseChunk: (chunk, { signal }) => rephraseChunkWithClaude(chunk, model, signal) };
}
