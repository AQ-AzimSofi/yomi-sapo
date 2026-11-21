import { AI_MODELS, VN_RETRY_CONFIG } from '../../lib/constants';
import { rephraseWithClaude, splitParagraphs } from '../utils/claude-rephrase';
import { stripRubyTags } from './chunking';
import { findFormatProblem, sanitizeRephraseResponse, type SanitizedRephrase } from './rephraseFormat';
import {
  describeError,
  describeUnusableKey,
  isRetryable,
  isUnknownModel,
  PAID_API_KEY_ENV_NAME,
  pickKey,
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

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const FALLBACK_ERROR = 'Used original text (rephrase failed)';
const RESUME_HINT = 'Progress is saved. Run the same command again to resume from this chunk.';
const CORRECTION_PREFIX = '回答のフォーマットが正しくありません。もう一度やり直してください。必ず下記の構成に従ってください。\n';
const MAX_RETRY_WAIT_SECS = 30;

export interface ChunkOutput {
  rawText: string;
  readerText: string;
  attempts: number;
  /** The rephrase failed and every line stands in as its own rephrase; the next run retries the chunk. */
  isFallback: boolean;
  error?: string;
}

export interface ChunkRephraser {
  /** Free keys the delay between chunks is shared over; 1 when there is no key rotation. */
  keyCount: number;
  rephraseChunk: (chunk: string, chunkIndex: number) => Promise<ChunkOutput>;
}

interface ModelRequest {
  model: string;
  keyPool: KeyPool;
  chunkIndex: number;
  cleanChunk: string;
}

interface ModelAttempt {
  attempt: number;
  instruction: string;
}

// out-of-keys and model-unavailable stop the run rather than save original text for every chunk that follows.
type ModelResult =
  | { outcome: 'rephrased'; response: string; requestCount: number }
  | { outcome: 'attempts-used-up'; requestCount: number }
  | { outcome: 'out-of-keys'; requestCount: number }
  | { outcome: 'model-unavailable'; requestCount: number };

async function generateText(key: ApiKey, model: string, prompt: string): Promise<string> {
  const response = await key.client.models.generateContent({ model, contents: prompt });
  return response.text || '';
}

// Each attempt moves to the next free key, so one key's transient errors do not sink the chunk.
async function requestWithModel(request: ModelRequest, current: ModelAttempt): Promise<ModelResult> {
  const { model, keyPool } = request;
  const maxAttempts = VN_RETRY_CONFIG.MAX_ATTEMPTS;
  const requestCount = current.attempt - 1;
  if (current.attempt > maxAttempts) return { outcome: 'attempts-used-up', requestCount };
  const key = pickKey(keyPool, request.chunkIndex + current.attempt - 1);
  if (!key) return { outcome: 'out-of-keys', requestCount };

  console.log(`    Attempt ${current.attempt}/${maxAttempts} (${key.envName})...`);
  const outcome = await generateText(key, model, current.instruction + request.cleanChunk).then(
    (text) => ({ text, error: undefined }),
    (error: unknown) => ({ text: undefined, error }),
  );
  if (outcome.text !== undefined) {
    const formatProblem = findFormatProblem(outcome.text);
    if (!formatProblem) return { outcome: 'rephrased', response: outcome.text, requestCount: current.attempt };
    console.log(`    Invalid format (${formatProblem}), retrying with correction prompt...`);
    console.log('    Response preview:', outcome.text.slice(0, 200).replace(/\n/g, '\\n'));
    return requestWithModel(request, { attempt: current.attempt + 1, instruction: CORRECTION_PREFIX + ai_instructions });
  }

  console.error(`    API error on attempt ${current.attempt}:`, describeError(outcome.error));
  const isFreeKey = key !== keyPool.paidKey;
  const unusableKeyReason = describeUnusableKey(outcome.error, model);
  // A retired key does not use up an attempt: the next key gets the same one.
  if (unusableKeyReason && isFreeKey) {
    retireKey(keyPool, key, unusableKeyReason);
    return requestWithModel(request, current);
  }
  if (unusableKeyReason) return { outcome: 'out-of-keys', requestCount: current.attempt };
  if (isUnknownModel(outcome.error)) {
    console.log(`    Model ${model} unavailable, trying next fallback...`);
    return { outcome: 'model-unavailable', requestCount: current.attempt };
  }
  if (!isRetryable(outcome.error) || current.attempt >= maxAttempts) {
    return { outcome: 'attempts-used-up', requestCount: current.attempt };
  }
  const waitSecs = Math.min(MAX_RETRY_WAIT_SECS, current.attempt * 10);
  console.log(`    Waiting ${waitSecs}s before retry...`);
  await sleep(waitSecs * 1000);
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
 * request to the next key; a per-minute limit or a server error waits and retries. Only an unknown
 * model moves on to the next model in the fallback order. Daily quotas are per model, so every
 * model keeps its own pool of retired keys.
 */
export function createGeminiRephraser(model: string, createPool: () => KeyPool): ChunkRephraser {
  const poolsByModel = new Map<string, KeyPool>();
  const getPool = (poolModel: string): KeyPool => {
    const existingPool = poolsByModel.get(poolModel);
    if (existingPool) return existingPool;
    const newPool = createPool();
    poolsByModel.set(poolModel, newPool);
    return newPool;
  };
  const requestedModelPool = getPool(model);

  const rephraseChunk = async (chunk: string, chunkIndex: number): Promise<ChunkOutput> => {
    const cleanChunk = stripRubyTags(chunk);
    const result = await listModelsToTry(model).reduce<Promise<ModelResult & { usedModel: string }>>(
      async (previous, currentModel) => {
        const earlier = await previous;
        if (earlier.outcome !== 'model-unavailable') return earlier;
        console.log(`    Trying model: ${currentModel}`);
        const request = { model: currentModel, keyPool: getPool(currentModel), chunkIndex, cleanChunk };
        const modelResult = await requestWithModel(request, { attempt: 1, instruction: ai_instructions });
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

  return { keyCount: Math.max(requestedModelPool.freeKeys.length, 1), rephraseChunk };
}

// A failed claude -p call (usage limit, sign-in) stops the run; this chunk stays unfinished, so rerunning resumes it.
async function rephraseChunkWithClaude(chunk: string, model: string): Promise<ChunkOutput> {
  const rephrased = await rephraseWithClaude(splitParagraphs(stripRubyTags(chunk)), model).catch((error: unknown) => {
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

export function createClaudeRephraser(model: string): ChunkRephraser {
  return { keyCount: 1, rephraseChunk: (chunk) => rephraseChunkWithClaude(chunk, model) };
}
