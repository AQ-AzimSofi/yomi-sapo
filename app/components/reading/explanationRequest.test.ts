import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPLANATION_MODE } from '@/lib/constants';
import { ApiError } from '@/lib/api/client';
import type { ExplanationRequest, ExplanationResponse } from '@/lib/api/contracts';
import type { CachedExplanation } from '@/lib/types';
import { IDLE_EXPLANATION, nextExplanationDisplay, type ExplanationEvent } from './explanationDisplay';
import { askForExplanation, describeExplanationFailure, type ExplanationTarget } from './explanationRequest';

function deferred<T>() {
  const handlers: { resolve: (value: T) => void; reject: (error: unknown) => void } = { resolve: () => {}, reject: () => {} };
  const promise = new Promise<T>((resolve, reject) => Object.assign(handlers, { resolve, reject }));
  return { promise, ...handlers };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createAsker(saved: CachedExplanation | null = null) {
  const events: ExplanationEvent[] = [];
  const issuedIds: number[] = [];
  const replies: Array<ReturnType<typeof deferred<ExplanationResponse>>> = [];
  const asker = {
    getCache: vi.fn(() => saved),
    setCache: vi.fn(),
    explain: vi.fn((_request: ExplanationRequest) => {
      const reply = deferred<ExplanationResponse>();
      replies.push(reply);
      return reply.promise;
    }),
    dispatch: (event: ExplanationEvent) => {
      events.push(event);
    },
    nextRequestId: () => {
      issuedIds.push(issuedIds.length + 1);
      return issuedIds.length;
    },
    pending: new Map<string, Promise<string>>(),
  };
  return { asker, replies, display: () => events.reduce(nextExplanationDisplay, IDLE_EXPLANATION) };
}

const TARGET: ExplanationTarget = {
  fileName: 'book',
  sentence: '二文目。',
  surroundings: { before: '前の段落。\n一文目。', after: '三文目。\n次の段落。' },
  contextSize: 5,
  mode: DEFAULT_EXPLANATION_MODE,
};
// Five characters on each side of the sentence, as contextSize asks.
const TARGET_CONTEXT = '\n一文目。二文目。三文目。\n';

const SAVED: CachedExplanation = { sentence: '二文目。', context: TARGET_CONTEXT, explanation: '保存済み', contextSize: 5, timestamp: 7 };

const reply = (explanation: string): ExplanationResponse => ({ explanation, message: '' });

describe('askForExplanation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a saved answer without asking the AI', () => {
    const { asker, display } = createAsker(SAVED);

    askForExplanation(asker, TARGET, { bypassCache: false });

    expect(asker.explain).not.toHaveBeenCalled();
    expect(display()).toEqual({ status: 'ready', text: '保存済み', cachedAt: 7 });
  });

  it('looks the answer up for the sentence, the chosen context size and the passage around it', () => {
    const { asker } = createAsker(SAVED);

    askForExplanation(asker, TARGET, { bypassCache: false });

    expect(asker.getCache).toHaveBeenCalledWith({
      fileName: 'book',
      sentence: '二文目。',
      mode: DEFAULT_EXPLANATION_MODE,
      contextSize: 5,
      context: TARGET_CONTEXT,
    });
  });

  it('sends the passage around the sentence, cut to the chosen context size', () => {
    const { asker } = createAsker();

    askForExplanation(asker, TARGET, { bypassCache: false });

    expect(asker.explain).toHaveBeenCalledWith({
      sentence: '二文目。',
      context: TARGET_CONTEXT,
      fileName: 'book',
      contextSize: 5,
      mode: DEFAULT_EXPLANATION_MODE,
    });
  });

  it('asks the AI despite a saved answer when regenerating', () => {
    const { asker, display } = createAsker(SAVED);

    askForExplanation(asker, TARGET, { bypassCache: true });

    expect(asker.getCache).not.toHaveBeenCalled();
    expect(asker.explain).toHaveBeenCalledTimes(1);
    expect(display()).toEqual({ status: 'loading', requestId: 1 });
  });

  it('saves the answer with its passage and shows it as fresh', async () => {
    const { asker, replies, display } = createAsker();

    askForExplanation(asker, TARGET, { bypassCache: false });
    replies[0].resolve(reply('新しい説明'));
    await settle();

    expect(asker.setCache).toHaveBeenCalledWith(expect.objectContaining({ sentence: '二文目。', context: TARGET_CONTEXT, explanation: '新しい説明' }));
    expect(display()).toEqual({ status: 'ready', text: '新しい説明' });
  });

  // A late answer must not replace a newer saved one, so it carries the time it was asked for.
  it('saves the answer with the time it was requested, not the time it arrived', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { asker, replies } = createAsker();

    askForExplanation(asker, TARGET, { bypassCache: false });
    vi.setSystemTime(9000);
    replies[0].resolve(reply('説明'));
    await settle();

    expect(asker.setCache).toHaveBeenCalledWith(expect.objectContaining({ requestedAt: 1000 }));
  });

  it('saves a late answer for an earlier sentence but keeps showing the current one', async () => {
    const { asker, replies, display } = createAsker();

    askForExplanation(asker, { ...TARGET, sentence: '一文目。' }, { bypassCache: false });
    askForExplanation(asker, TARGET, { bypassCache: false });
    replies[0].resolve(reply('一文目の説明'));
    await settle();

    expect(asker.setCache).toHaveBeenCalledWith(expect.objectContaining({ sentence: '一文目。', explanation: '一文目の説明' }));
    expect(display()).toEqual({ status: 'loading', requestId: 2 });

    replies[1].resolve(reply('二文目の説明'));
    await settle();

    expect(display()).toEqual({ status: 'ready', text: '二文目の説明' });
  });

  it('never lets a failed earlier request replace the current answer', async () => {
    const { asker, replies, display } = createAsker();

    askForExplanation(asker, { ...TARGET, sentence: '一文目。' }, { bypassCache: false });
    askForExplanation(asker, TARGET, { bypassCache: false });
    replies[1].resolve(reply('二文目の説明'));
    replies[0].reject(new Error('失敗'));
    await settle();

    expect(display()).toEqual({ status: 'ready', text: '二文目の説明' });
  });

  it('joins the request already out for the same ask and shows its answer', async () => {
    const { asker, replies, display } = createAsker();

    askForExplanation(asker, TARGET, { bypassCache: false });
    askForExplanation(asker, TARGET, { bypassCache: false });
    replies[0].resolve(reply('説明'));
    await settle();

    expect(asker.explain).toHaveBeenCalledTimes(1);
    expect(display()).toEqual({ status: 'ready', text: '説明' });
  });

  it('shows a failure and saves nothing', async () => {
    const { asker, replies, display } = createAsker();

    askForExplanation(asker, TARGET, { bypassCache: false });
    replies[0].reject(new Error('通信できません'));
    await settle();

    expect(asker.setCache).not.toHaveBeenCalled();
    expect(display()).toEqual({ status: 'error', message: '通信できません' });
  });
});

describe('describeExplanationFailure', () => {
  const apiError = (promptedGuestKey: boolean) =>
    new ApiError({ status: 401, statusText: 'Unauthorized', body: null, promptedGuestKey });

  it('asks a guest for their key when the failure prompted for it', () => {
    expect(describeExplanationFailure(apiError(true))).toBe('Guest mode: add or update your Gemini API key to use AI explanations.');
  });

  it('names the HTTP status of any other API failure', () => {
    expect(describeExplanationFailure(apiError(false))).toBe('Failed to fetch explanation: Unauthorized');
  });

  it('shows the message of any other error', () => {
    expect(describeExplanationFailure(new Error('通信できません'))).toBe('通信できません');
    expect(describeExplanationFailure('奇妙な失敗')).toBe('An unknown error occurred');
  });
});
