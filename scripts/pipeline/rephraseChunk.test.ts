import { ApiError, type GoogleGenAI } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VN_RETRY_CONFIG } from '../../lib/constants';
import { createKeyPool } from '../shared/geminiKeyPool';
import { createGeminiRephraser } from './rephraseChunk';

vi.mock('node:timers/promises', () => import('../shared/fakeTimersPromises'));

const SOURCE = '吾輩は猫である。名前はまだ無い。';
const VALID_RESPONSE = `< ${SOURCE}\n>> 私は猫です。名前はありません。`;
const DAILY_QUOTA_ERROR = new ApiError({ status: 429, message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' });
const RATE_LIMIT_ERROR = new ApiError({ status: 429, message: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' });

function rateLimitAsking(retryDelay: string): ApiError {
  const body = { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] } };
  return new ApiError({ status: 429, message: JSON.stringify(body) });
}

interface GeminiCall {
  apiKey: string;
  model: string;
  abortSignal?: AbortSignal;
  atMs: number;
}

type ReplyToCall = (call: GeminiCall, callIndex: number) => string;

function createFakeRephraser(env: NodeJS.ProcessEnv, replyToCall: ReplyToCall, delaySeconds = 0) {
  const calls: GeminiCall[] = [];
  const createClient = (apiKey: string) =>
    ({
      models: {
        generateContent: async ({ model, config }: { model: string; config?: { abortSignal?: AbortSignal } }) => {
          const call = { apiKey, model, abortSignal: config?.abortSignal, atMs: Date.now() };
          calls.push(call);
          return { text: replyToCall(call, calls.length - 1) };
        },
      },
    }) as unknown as GoogleGenAI;
  const rephraser = createGeminiRephraser({ model: 'gemini-3.5-flash', delaySeconds }, () => createKeyPool(env, createClient));
  return { rephraser, calls };
}

// Each chunk on its own worker, as the worker pool spreads them when there are enough keys.
function chunkRequest(chunkIndex: number, signal = new AbortController().signal) {
  return { chunkIndex, workerIndex: chunkIndex, signal };
}

const FREE_AND_PAID_KEYS = { GEMINI_API_KEY: 'free1', GEMINI_API_KEY2: 'free2', GEMINI_API_KEY_PAID: 'paid' };

describe('createGeminiRephraser', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('Test_createGeminiRephraser_OneWorkerPerFreeKey', () => {
    expect(createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE).rephraser.maxConcurrency).toBe(2);
  });

  it('Test_createGeminiRephraser_OneWorkerWithOnlyThePaidKey', () => {
    expect(createFakeRephraser({ GEMINI_API_KEY_PAID: 'paid' }, () => VALID_RESPONSE).rephraser.maxConcurrency).toBe(1);
  });

  it('Test_createGeminiRephraser_EachWorkerStartsOnItsOwnKey', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE);
    await rephraser.rephraseChunk(SOURCE, chunkRequest(1));
    expect(calls).toMatchObject([{ apiKey: 'free2', model: 'gemini-3.5-flash' }]);
  });

  it('Test_createGeminiRephraser_RequestCarriesTheStopSignal', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE);
    const stopController = new AbortController();
    await rephraser.rephraseChunk(SOURCE, chunkRequest(0, stopController.signal));
    expect(calls[0].abortSignal).toBe(stopController.signal);
  });

  it('Test_createGeminiRephraser_ValidReplyIsAlignedToSource', async () => {
    const { rephraser } = createFakeRephraser(FREE_AND_PAID_KEYS, () => `以下が要約です。\n${VALID_RESPONSE}`);
    const output = await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    expect(output).toEqual({ rawText: `以下が要約です。\n${VALID_RESPONSE}`, readerText: VALID_RESPONSE, attempts: 1, isFallback: false });
  });

  it('Test_createGeminiRephraser_DailyQuotaRetiresKeyWithoutUsingAnAttempt', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.apiKey === 'free1') throw DAILY_QUOTA_ERROR;
      return VALID_RESPONSE;
    });
    const output = await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2']);
    expect(output.attempts).toBe(1);
  });

  it('Test_createGeminiRephraser_PaidKeyBeforeModelFallback', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.apiKey !== 'paid') throw DAILY_QUOTA_ERROR;
      return VALID_RESPONSE;
    });
    await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    expect(calls.at(-1)).toMatchObject({ apiKey: 'paid', model: 'gemini-3.5-flash' });
  });

  it('Test_createGeminiRephraser_RetiredKeyStaysRetiredForLaterChunks', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.apiKey === 'free1') throw DAILY_QUOTA_ERROR;
      return VALID_RESPONSE;
    });
    await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    await rephraser.rephraseChunk(SOURCE, chunkRequest(2));
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2', 'free2']);
  });

  it('Test_createGeminiRephraser_UnknownModelFallsBackToNextModel', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (call) => {
      if (call.model === 'gemini-3.5-flash') throw new ApiError({ status: 404, message: 'model not found' });
      return VALID_RESPONSE;
    });
    await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    expect(calls.map((call) => call.model)).toEqual(['gemini-3.5-flash', 'gemini-3-flash-preview']);
  });

  it('Test_createGeminiRephraser_InvalidFormatRetriesWithNextKey', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, (_, callIndex) => (callIndex === 0 ? 'no pairs here' : VALID_RESPONSE));
    const output = await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2']);
    expect(output.attempts).toBe(2);
  });

  it('Test_createGeminiRephraser_NoKeyWithQuotaLeftStopsTheRun', async () => {
    const { rephraser, calls } = createFakeRephraser({ GEMINI_API_KEY: 'free1' }, () => {
      throw DAILY_QUOTA_ERROR;
    });
    await expect(rephraser.rephraseChunk(SOURCE, chunkRequest(0))).rejects.toThrow('No Gemini key has quota left for gemini-3.5-flash');
    expect(calls.map((call) => call.model)).toEqual(['gemini-3.5-flash']);
  });

  it('Test_createGeminiRephraser_PaidKeyOutOfQuotaStopsTheRunWithoutModelFallback', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => {
      throw DAILY_QUOTA_ERROR;
    });
    await expect(rephraser.rephraseChunk(SOURCE, chunkRequest(0))).rejects.toThrow('No Gemini key has quota left');
    expect(new Set(calls.map((call) => call.model))).toEqual(new Set(['gemini-3.5-flash']));
  });

  it('Test_createGeminiRephraser_SuccessIsNotAFallback', async () => {
    const { rephraser } = createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE);
    expect((await rephraser.rephraseChunk(SOURCE, chunkRequest(0))).isFallback).toBe(false);
  });

  it('Test_createGeminiRephraser_UnknownModelEverywhereStopsTheRun', async () => {
    const { rephraser } = createFakeRephraser(FREE_AND_PAID_KEYS, () => {
      throw new ApiError({ status: 404, message: 'model not found' });
    });
    await expect(rephraser.rephraseChunk(SOURCE, chunkRequest(0))).rejects.toThrow('No Gemini model could be reached');
  });
});

describe('createGeminiRephraser when attempts fail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function rephraseWithTimers(replyToCall: ReplyToCall) {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, replyToCall);
    const pendingOutput = rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    await vi.runAllTimersAsync();
    return { output: await pendingOutput, calls };
  }

  function secondsBetweenCalls(calls: readonly GeminiCall[]): number[] {
    return calls.slice(1).map((call, callIndex) => (call.atMs - calls[callIndex].atMs) / 1000);
  }

  it('Test_createGeminiRephraser_RateLimitWaitsAsLongAsGeminiAsksOnTheSameKey', async () => {
    const { output, calls } = await rephraseWithTimers((_, callIndex) => {
      if (callIndex === 0) throw rateLimitAsking('36.2s');
      return VALID_RESPONSE;
    });
    expect(secondsBetweenCalls(calls)).toEqual([37]);
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free1']);
    expect(output).toMatchObject({ attempts: 1, isFallback: false });
  });

  it('Test_createGeminiRephraser_RateLimitWithoutRetryInfoBacksOffExponentially', async () => {
    const { output, calls } = await rephraseWithTimers((_, callIndex) => {
      if (callIndex < 3) throw RATE_LIMIT_ERROR;
      return VALID_RESPONSE;
    });
    expect(secondsBetweenCalls(calls)).toEqual([10, 20, 40]);
    expect(output).toMatchObject({ attempts: 1, isFallback: false });
  });

  it('Test_createGeminiRephraser_RateLimitThatNeverClearsEndsAsFallback', async () => {
    const { output, calls } = await rephraseWithTimers(() => {
      throw RATE_LIMIT_ERROR;
    });
    expect(output.isFallback).toBe(true);
    expect(calls.length).toBeGreaterThan(VN_RETRY_CONFIG.MAX_ATTEMPTS);
  });

  it('Test_createGeminiRephraser_StopEndsARateLimitWaitAtOnce', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => {
      throw RATE_LIMIT_ERROR;
    });
    const stopController = new AbortController();
    const outcome = rephraser.rephraseChunk(SOURCE, chunkRequest(0, stopController.signal)).catch((error: Error) => error.name);
    await vi.advanceTimersByTimeAsync(1000);
    stopController.abort();
    expect(await outcome).toBe('AbortError');
    expect(calls).toHaveLength(1);
  });

  it('Test_createGeminiRephraser_DelaySpacesRequestsOnTheSameKey', async () => {
    const { rephraser, calls } = createFakeRephraser({ GEMINI_API_KEY: 'free1' }, () => VALID_RESPONSE, 60);
    const outputs = Promise.all([rephraser.rephraseChunk(SOURCE, chunkRequest(0)), rephraser.rephraseChunk(SOURCE, chunkRequest(1))]);
    await vi.runAllTimersAsync();
    await outputs;
    expect(secondsBetweenCalls(calls)).toEqual([60]);
  });

  it('Test_createGeminiRephraser_DelayDoesNotHoldBackOtherKeys', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => VALID_RESPONSE, 60);
    const outputs = Promise.all([rephraser.rephraseChunk(SOURCE, chunkRequest(0)), rephraser.rephraseChunk(SOURCE, chunkRequest(1))]);
    await vi.runAllTimersAsync();
    await outputs;
    expect(calls.map((call) => call.apiKey)).toEqual(['free1', 'free2']);
    expect(secondsBetweenCalls(calls)).toEqual([0]);
  });

  it('Test_createGeminiRephraser_NoDelayByDefault', async () => {
    const { rephraser, calls } = createFakeRephraser({ GEMINI_API_KEY: 'free1' }, () => VALID_RESPONSE);
    await rephraser.rephraseChunk(SOURCE, chunkRequest(0));
    await rephraser.rephraseChunk(SOURCE, chunkRequest(1));
    expect(secondsBetweenCalls(calls)).toEqual([0]);
  });

  it('Test_createGeminiRephraser_ServerErrorsKeepOriginalTextAsFallback', async () => {
    const { output } = await rephraseWithTimers(() => {
      throw new ApiError({ status: 503, message: 'overloaded' });
    });
    expect(output.readerText).toBe(`< ${SOURCE}\n>> ${SOURCE}`);
    expect(output.isFallback).toBe(true);
  });

  it('Test_createGeminiRephraser_ServerErrorsStayOnTheRequestedModel', async () => {
    const { calls } = await rephraseWithTimers(() => {
      throw new ApiError({ status: 503, message: 'overloaded' });
    });
    expect(calls.map((call) => call.model)).toEqual(Array(VN_RETRY_CONFIG.MAX_ATTEMPTS).fill('gemini-3.5-flash'));
  });

  it('Test_createGeminiRephraser_PerMinuteLimitBacksOffOnTheSameModel', async () => {
    const { output, calls } = await rephraseWithTimers((_, callIndex) => {
      if (callIndex === 0) throw new ApiError({ status: 429, message: 'GenerateRequestsPerMinutePerProjectPerModel' });
      return VALID_RESPONSE;
    });
    expect(calls.map((call) => call.model)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);
    expect(output.isFallback).toBe(false);
  });

  it('Test_createGeminiRephraser_StopEndsARetryWaitAtOnce', async () => {
    const { rephraser, calls } = createFakeRephraser(FREE_AND_PAID_KEYS, () => {
      throw new ApiError({ status: 503, message: 'overloaded' });
    });
    const stopController = new AbortController();
    const pendingOutput = rephraser.rephraseChunk(SOURCE, chunkRequest(0, stopController.signal));
    const outcome = pendingOutput.catch((error: Error) => error.name);
    await vi.advanceTimersByTimeAsync(1000);
    stopController.abort();
    expect(await outcome).toBe('AbortError');
    expect(calls).toHaveLength(1);
  });

  it('Test_createGeminiRephraser_InvalidFormatEveryTimeStaysOnTheRequestedModel', async () => {
    const { output, calls } = await rephraseWithTimers(() => 'no pairs here');
    expect(new Set(calls.map((call) => call.model))).toEqual(new Set(['gemini-3.5-flash']));
    expect(output.isFallback).toBe(true);
  });
});
