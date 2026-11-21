import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAIClient } from '@/lib/ai';
import { GUEST_KEY_HEADERS } from '@/lib/constants';
import { ownerSessionHeaders, TEST_SESSION_SECRET } from '@/lib/auth/testSession';
import { POST as explainSentence } from './explain-sentence/route';
import { POST as prioritize } from './prioritize/route';
import { POST as translate } from './translate/route';
import { POST as synthesizeSpeech } from './tts/route';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai', () => ({
  getAIClient: vi.fn(() => ({ models: { generateContent } })),
  ai_instructions_quick: 'quick',
  ai_instructions_story: 'story',
  ai_instructions_nuance: 'nuance',
  ai_instructions_speaker: 'speaker',
  ai_instructions_narrative: 'narrative',
}));

const OWNER_HEADERS = await ownerSessionHeaders();
const upstreamFetch = vi.fn();

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'owner-translate-key');
  vi.stubEnv('GOOGLE_TTS_API_KEY', 'owner-tts-key');
  vi.stubGlobal('fetch', upstreamFetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('a guest without their own key', () => {
  it.each([
    ['explain-sentence', explainSentence, { sentence: '本を読む。' }, 'gemini'],
    ['prioritize', prioritize, { sentences: ['本を読む。'] }, 'gemini'],
    ['translate', translate, { text: '本を読む。' }, 'translate'],
    ['tts', synthesizeSpeech, { text: '本を読む。' }, 'tts'],
  ] as const)('gets 401 with the requiresGuestKey the key modal reads from %s', async (_route, handler, body, kind) => {
    const response = await handler(postRequest(body));

    expect(response.status).toBe(401);
    expect((await response.json()).requiresGuestKey).toBe(kind);
    expect(generateContent).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('a body with a wrong-typed field', () => {
  it.each([
    ['explain-sentence context', explainSentence, { sentence: '本を読む。', context: 5 }],
    ['translate targetLanguage', translate, { text: '本を読む。', targetLanguage: 5 }],
    ['tts speed', synthesizeSpeech, { text: '本を読む。', speed: 'fast' }],
    ['tts voiceGender', synthesizeSpeech, { text: '本を読む。', voiceGender: 'ROBOT' }],
  ] as const)('answers 400 without calling Google for a bad %s', async (_field, handler, body) => {
    const response = await handler(postRequest(body, OWNER_HEADERS));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_body');
    expect(generateContent).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/explain-sentence', () => {
  it("explains with the guest's own Gemini key", async () => {
    generateContent.mockResolvedValue({ text: '説明' });

    const response = await explainSentence(postRequest({ sentence: '本を読む。' }, { [GUEST_KEY_HEADERS.GEMINI]: 'guest-key' }));

    expect(await response.json()).toStrictEqual({ explanation: '説明', message: '説明を取得しました' });
    expect(getAIClient).toHaveBeenCalledWith('guest-key');
  });

  it("explains with the owner's key for the signed-in owner, ignoring a guest key", async () => {
    generateContent.mockResolvedValue({ text: '説明' });

    await explainSentence(postRequest({ sentence: '本を読む。' }, { ...OWNER_HEADERS, [GUEST_KEY_HEADERS.GEMINI]: 'stale' }));

    expect(getAIClient).toHaveBeenCalledWith(undefined);
  });

  it('answers 400 without calling Gemini when there is no sentence', async () => {
    const response = await explainSentence(postRequest({ context: '前後' }, OWNER_HEADERS));

    expect(response.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('answers a generic 500 that does not pass on the Gemini error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generateContent.mockRejectedValue(new Error('API key not valid. Please pass a valid API key.'));

    const response = await explainSentence(postRequest({ sentence: '本を読む。' }, OWNER_HEADERS));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('API key not valid');
  });
});

describe('POST /api/prioritize', () => {
  it("scores with the guest's own Gemini key", async () => {
    generateContent.mockResolvedValue({ text: '{"scores":[3]}' });

    await prioritize(postRequest({ sentences: ['本を読む。'] }, { [GUEST_KEY_HEADERS.GEMINI]: 'guest-key' }));

    expect(getAIClient).toHaveBeenCalledWith('guest-key');
  });

  it('answers 400 for an empty page', async () => {
    const response = await prioritize(postRequest({ sentences: [] }, OWNER_HEADERS));

    expect(response.status).toBe(400);
  });

  it('answers 502 when the model skips a sentence', async () => {
    generateContent.mockResolvedValue({ text: '{"scores":[5]}' });

    const response = await prioritize(postRequest({ sentences: ['一。', '二。'] }, OWNER_HEADERS));

    expect(response.status).toBe(502);
  });

  it('clamps the scores the model returns', async () => {
    generateContent.mockResolvedValue({ text: '{"scores":[9,0]}' });

    const response = await prioritize(postRequest({ sentences: ['一。', '二。'] }, OWNER_HEADERS));

    expect(await response.json()).toStrictEqual({ scores: [5, 1] });
  });
});

describe('POST /api/translate', () => {
  it("translates with the owner's key for the signed-in owner", async () => {
    upstreamFetch.mockResolvedValue(Response.json({ data: { translations: [{ translatedText: 'I read a book.' }] } }));

    const response = await translate(postRequest({ text: '本[ほん]を読む。' }, OWNER_HEADERS));

    expect(await response.json()).toStrictEqual({ translatedText: 'I read a book.' });
    expect(upstreamFetch).toHaveBeenCalledWith(expect.stringContaining('key=owner-translate-key'), expect.anything());
  });

  it("translates with the guest's own key", async () => {
    upstreamFetch.mockResolvedValue(Response.json({ data: { translations: [{ translatedText: 'I read a book.' }] } }));

    await translate(postRequest({ text: '本を読む。' }, { [GUEST_KEY_HEADERS.TRANSLATE]: 'guest-key' }));

    expect(upstreamFetch).toHaveBeenCalledWith(expect.stringContaining('key=guest-key'), expect.anything());
  });

  it('answers 400 without calling Google when there is no text', async () => {
    const response = await translate(postRequest({}, OWNER_HEADERS));

    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/tts', () => {
  it("speaks with the guest's own key", async () => {
    upstreamFetch.mockResolvedValue(Response.json({ audioContent: 'bXAz' }));

    await synthesizeSpeech(postRequest({ text: '本を読む。' }, { [GUEST_KEY_HEADERS.TTS]: 'guest-key' }));

    expect(upstreamFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Goog-Api-Key': 'guest-key' }) })
    );
  });

  it('answers 504 when Google TTS times out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    upstreamFetch.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    const response = await synthesizeSpeech(postRequest({ text: '本を読む。' }, OWNER_HEADERS));

    expect(response.status).toBe(504);
  });

  it('answers a generic 500 that does not pass on a network error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    upstreamFetch.mockRejectedValue(new TypeError('fetch failed: getaddrinfo ENOTFOUND texttospeech.googleapis.com'));

    const response = await synthesizeSpeech(postRequest({ text: '本を読む。' }, OWNER_HEADERS));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('ENOTFOUND');
  });

  it('answers 502 when Google TTS refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    upstreamFetch.mockResolvedValue(new Response('quota', { status: 429 }));

    const response = await synthesizeSpeech(postRequest({ text: '本を読む。' }, OWNER_HEADERS));

    expect(response.status).toBe(502);
  });

  it('returns the audio Google TTS made', async () => {
    upstreamFetch.mockResolvedValue(Response.json({ audioContent: 'bXAz' }));

    const response = await synthesizeSpeech(postRequest({ text: '本を読む。', speed: 1.2 }, OWNER_HEADERS));

    expect(await response.json()).toStrictEqual({ audioContent: 'bXAz', message: '音声を生成しました' });
  });
});
