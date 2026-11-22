import { ApiError, type GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import {
  createKeyPool,
  describeUnusableKey,
  isRateLimited,
  isRetryable,
  isUnknownModel,
  listFreeKeyEnvNames,
  pickKey,
  readRetryDelaySecs,
  retireKey,
} from './geminiKeyPool';

const createFakeClient = (apiKey: string) => ({ apiKey }) as unknown as GoogleGenAI;

function createSamplePool() {
  return createKeyPool({ GEMINI_API_KEY: 'a', GEMINI_API_KEY2: 'b', GEMINI_API_KEY_PAID: 'p' }, createFakeClient);
}

describe('listFreeKeyEnvNames', () => {
  it('Test_listFreeKeyEnvNames_FindsEveryNumberedKeyInOrder', () => {
    const env = { GEMINI_API_KEY10: 'j', GEMINI_API_KEY: 'a', GEMINI_API_KEY7: 'g', GEMINI_API_KEY2: 'b' };
    expect(listFreeKeyEnvNames(env)).toEqual(['GEMINI_API_KEY', 'GEMINI_API_KEY2', 'GEMINI_API_KEY7', 'GEMINI_API_KEY10']);
  });

  it('Test_listFreeKeyEnvNames_SkipsPaidOtherAndEmptyNames', () => {
    const env = { GEMINI_API_KEY_PAID: 'p', GEMINI_API_KEY_OLD: 'o', GEMINI_API_KEY3: '', GOOGLE_TTS_API_KEY: 't' };
    expect(listFreeKeyEnvNames(env)).toEqual([]);
  });
});

describe('createKeyPool', () => {
  it('Test_createKeyPool_SeparatesPaidKey', () => {
    const pool = createSamplePool();
    expect(pool.freeKeys.map((key) => key.envName)).toEqual(['GEMINI_API_KEY', 'GEMINI_API_KEY2']);
    expect(pool.paidKey?.envName).toBe('GEMINI_API_KEY_PAID');
  });

  it('Test_createKeyPool_PaidKeyAlone', () => {
    expect(createKeyPool({ GEMINI_API_KEY_PAID: 'p' }, createFakeClient).freeKeys).toEqual([]);
  });

  it('Test_createKeyPool_NoKeyThrows', () => {
    expect(() => createKeyPool({}, createFakeClient)).toThrow(/No Gemini API key/);
  });
});

describe('pickKey', () => {
  it('Test_pickKey_SpreadsOverFreeKeys', () => {
    const pool = createSamplePool();
    expect([0, 1, 2].map((index) => pickKey(pool, index)?.envName)).toEqual(['GEMINI_API_KEY', 'GEMINI_API_KEY2', 'GEMINI_API_KEY']);
  });

  it('Test_pickKey_SkipsRetiredFreeKey', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pool = createSamplePool();
    retireKey(pool, pool.freeKeys[0], 'out of daily quota');
    expect(pickKey(pool, 0)?.envName).toBe('GEMINI_API_KEY2');
  });

  it('Test_pickKey_FallsBackToPaidKeyOnceEveryFreeKeyIsRetired', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pool = createSamplePool();
    pool.freeKeys.forEach((key) => retireKey(pool, key, 'out of daily quota'));
    expect(pickKey(pool, 0)?.envName).toBe('GEMINI_API_KEY_PAID');
  });

  it('Test_pickKey_NoPaidKeyLeavesNothing', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pool = createKeyPool({ GEMINI_API_KEY: 'a' }, createFakeClient);
    retireKey(pool, pool.freeKeys[0], 'out of daily quota');
    expect(pickKey(pool, 0)).toBeUndefined();
  });
});

describe('describeUnusableKey', () => {
  it('Test_describeUnusableKey_DailyQuota', () => {
    const error = new ApiError({ status: 429, message: 'Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel-FreeTier' });
    expect(describeUnusableKey(error, 'gemini-3.5-flash')).toBe('out of daily quota for gemini-3.5-flash');
  });

  it('Test_describeUnusableKey_PerMinuteLimitKeepsKey', () => {
    const error = new ApiError({ status: 429, message: 'Quota exceeded for metric GenerateRequestsPerMinutePerProjectPerModel' });
    expect(describeUnusableKey(error, 'gemini-3.5-flash')).toBeUndefined();
  });

  it('Test_describeUnusableKey_RejectedKey', () => {
    expect(describeUnusableKey(new ApiError({ status: 403, message: 'forbidden' }), 'm')).toMatch(/^rejected/);
  });
});

describe('isRetryable', () => {
  it('Test_isRetryable_RateLimitAndServerErrors', () => {
    expect([429, 500, 503].map((status) => isRetryable(new ApiError({ status, message: '' })))).toEqual([true, true, true]);
  });

  it('Test_isRetryable_UnknownModel', () => {
    expect(isRetryable(new ApiError({ status: 404, message: 'not found' }))).toBe(false);
  });

  it('Test_isRetryable_NetworkFailure', () => {
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
  });
});

describe('isUnknownModel', () => {
  it('Test_isUnknownModel_NotFound', () => {
    expect(isUnknownModel(new ApiError({ status: 404, message: 'models/gemini-x is not found' }))).toBe(true);
  });

  it('Test_isUnknownModel_RateLimitIsNot', () => {
    expect(isUnknownModel(new ApiError({ status: 429, message: '' }))).toBe(false);
  });
});

const RATE_LIMIT_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '36.5s' },
    ],
  },
});

describe('isRateLimited', () => {
  it.each([
    ['a per-minute 429', new ApiError({ status: 429, message: RATE_LIMIT_BODY }), true],
    ['a per-day 429', new ApiError({ status: 429, message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }), false],
    ['a 503', new ApiError({ status: 503, message: 'overloaded' }), false],
    ['a network error', new Error('fetch failed'), false],
  ])('Test_isRateLimited %s', (_, error, expected) => {
    expect(isRateLimited(error)).toBe(expected);
  });
});

describe('readRetryDelaySecs', () => {
  it('Test_readRetryDelaySecs_RoundsTheRetryInfoDelayUp', () => {
    expect(readRetryDelaySecs(new ApiError({ status: 429, message: RATE_LIMIT_BODY }))).toBe(37);
  });

  it('Test_readRetryDelaySecs_NoRetryInfo', () => {
    expect(readRetryDelaySecs(new ApiError({ status: 429, message: 'Resource exhausted' }))).toBeUndefined();
  });
});
