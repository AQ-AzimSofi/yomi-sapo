import { ApiError, type GoogleGenAI } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyPool } from '../shared/geminiKeyPool';
import { createGeminiRephraser } from './rephraseChunk';

const SOURCE = '吾輩は猫である。名前はまだ無い。';
const VALID_RESPONSE = `< ${SOURCE}\n>> 私は猫です。名前はありません。`;
const DAILY_QUOTA_ERROR = new ApiError({ status: 429, message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' });

interface GeminiCall {
  apiKey: string;
  model: string;
}

type ReplyToCall = (call: GeminiCall, callIndex: number) => string;

function createFakeRephraser(env: NodeJS.ProcessEnv, replyToCall: ReplyToCall) {
  const calls: GeminiCall[] = [];
  const createClient = (apiKey: string) =>
    ({
      models: {
        generateContent: async ({ model }: { model: string }) => {
          const call = { apiKey, model };
          calls.push(call);
          return { text: replyToCall(call, calls.length - 1) };
        },
      },
    }) as unknown as GoogleGenAI;
  const rephraser = createGeminiRephraser('gemini-3.5-flash', () => createKeyPool(env, createClient));
  return { rephraser, calls };
}

const FREE_AND_PAID_KEYS = { GEMINI_API_KEY: 'free1', GEMINI_API_KEY2: 'free2', GEMINI_API_KEY_PAID: 'paid' };

describe('createGeminiRephraser', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('Test_createGeminiRephraser_KeyCountIsFreeKeys', () => {
    expect(createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE).rephraser.keyCount).toBe(2);
  });

  it('Test_createGeminiRephraser_SpreadsChunksOverFreeKeys', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE);
    await rephraser.rephraseChunk(SOURCE, 1);
    expect(calls).toEqual([{ apiKey: 'free2', model: 'gemini-3.5-flash' }]);
  });

  it('Test_createGeminiRephraser_ValidReplyIsAlignedToSource', async () => {
    const { rephraser } = createFakeRephraser(FREE_AND_PAID_KEYS, () => `以下が要約です。\n${VALID_RESPONSE}`);
    const output = await rephraser.rephraseChunk(SOURCE, 0);
    expect(output).toEqual({ rawText: `以下が要約です。\n${VALID_RESPONSE}`, readerText: VALID_RESPONSE, attempts: 1 });
  });

  it('Test_createGeminiRephraser_DailyQuotaRetiresKeyWithoutUsingAnAttempt', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.apiKey === 'free1') throw DAILY_QUOTA_ERROR;
      return VALID_RESPONSE;
    });
    const output = await rephraser.rephraseChunk(SOURCE, 0);
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2']);
    expect(output.attempts).toBe(1);
  });

  it('Test_createGeminiRephraser_PaidKeyBeforeModelFallback', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.apiKey !== 'paid') throw DAILY_QUOTA_ERROR;
      return VALID_RESPONSE;
    });
    await rephraser.rephraseChunk(SOURCE, 0);
    expect(calls.at(-1)).toEqual({ apiKey: 'paid', model: 'gemini-3.5-flash' });
  });

  it('Test_createGeminiRephraser_RetiredKeyStaysRetiredForLaterChunks', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.apiKey === 'free1') throw DAILY_QUOTA_ERROR;
      return VALID_RESPONSE;
    });
    await rephraser.rephraseChunk(SOURCE, 0);
    await rephraser.rephraseChunk(SOURCE, 2);
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2', 'free2']);
  });

  it('Test_createGeminiRephraser_UnknownModelFallsBackToNextModel', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.model === 'gemini-3.5-flash') throw new ApiError({ status: 404, message: 'model not found' });
      return VALID_RESPONSE;
    });
    await rephraser.rephraseChunk(SOURCE, 0);
    expect(calls.map((call) => call.model)).toEqual(['gemini-3.5-flash', 'gemini-3-flash-preview']);
  });

  it('Test_createGeminiRephraser_InvalidFormatRetriesWithNextKey', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (_, callIndex) => (callIndex === 0 ? 'no pairs here' : VALID_RESPONSE));
    const output = await rephraser.rephraseChunk(SOURCE, 0);
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2']);
    expect(output.attempts).toBe(2);
  });

  it('Test_createGeminiRephraser_NoUsableKeyKeepsOriginalText', async () => {
    const { rephraser } = createFakeRephraser({ GEMINI_API_KEY: 'free1' }, () => {
      throw DAILY_QUOTA_ERROR;
    });
    const output = await rephraser.rephraseChunk(SOURCE, 0);
    expect(output.readerText).toBe(`< ${SOURCE}\n>> ${SOURCE}`);
    expect(output.error).toBe('Used original text (rephrase failed)');
  });
});
