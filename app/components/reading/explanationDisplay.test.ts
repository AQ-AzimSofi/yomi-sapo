import { describe, expect, it } from 'vitest';
import { IDLE_EXPLANATION, nextExplanationDisplay, type ExplanationDisplay, type ExplanationEvent } from './explanationDisplay';

function afterEvents(events: ExplanationEvent[], start: ExplanationDisplay = IDLE_EXPLANATION): ExplanationDisplay {
  return events.reduce(nextExplanationDisplay, start);
}

describe('nextExplanationDisplay', () => {
  it('starts idle', () => {
    expect(IDLE_EXPLANATION).toEqual({ status: 'idle' });
  });

  it('shows a cached answer with the time it was saved', () => {
    expect(afterEvents([{ type: 'cacheHit', text: '説明', cachedAt: 5 }])).toEqual({ status: 'ready', text: '説明', cachedAt: 5 });
  });

  it('loads while a request is out and shows its answer as fresh', () => {
    expect(afterEvents([{ type: 'requested', requestId: 1 }])).toEqual({ status: 'loading', requestId: 1 });
    expect(afterEvents([{ type: 'requested', requestId: 1 }, { type: 'answered', requestId: 1, text: '説明' }])).toEqual({
      status: 'ready',
      text: '説明',
    });
  });

  it('shows the failure of the current request', () => {
    expect(afterEvents([{ type: 'requested', requestId: 1 }, { type: 'failed', requestId: 1, message: '失敗' }])).toEqual({
      status: 'error',
      message: '失敗',
    });
  });

  it('ignores a late answer for an earlier sentence and then shows the current one', () => {
    const waitingForB = afterEvents([
      { type: 'requested', requestId: 1 },
      { type: 'requested', requestId: 2 },
      { type: 'answered', requestId: 1, text: 'Aの説明' },
    ]);

    expect(waitingForB).toEqual({ status: 'loading', requestId: 2 });
    expect(nextExplanationDisplay(waitingForB, { type: 'answered', requestId: 2, text: 'Bの説明' })).toEqual({
      status: 'ready',
      text: 'Bの説明',
    });
  });

  it('keeps the current answer when an earlier request lands after it', () => {
    expect(
      afterEvents([
        { type: 'requested', requestId: 1 },
        { type: 'requested', requestId: 2 },
        { type: 'answered', requestId: 2, text: 'Bの説明' },
        { type: 'answered', requestId: 1, text: 'Aの説明' },
      ])
    ).toEqual({ status: 'ready', text: 'Bの説明' });
  });

  it('never lets an earlier request turn the current one into an error', () => {
    expect(
      afterEvents([
        { type: 'requested', requestId: 1 },
        { type: 'requested', requestId: 2 },
        { type: 'failed', requestId: 1, message: 'Aの失敗' },
      ])
    ).toEqual({ status: 'loading', requestId: 2 });
  });

  it('keeps a cached answer shown after its request when the abandoned request lands', () => {
    expect(
      afterEvents([
        { type: 'requested', requestId: 1 },
        { type: 'cacheHit', text: 'Bの説明', cachedAt: 3 },
        { type: 'failed', requestId: 1, message: 'Aの失敗' },
        { type: 'answered', requestId: 1, text: 'Aの説明' },
      ])
    ).toEqual({ status: 'ready', text: 'Bの説明', cachedAt: 3 });
  });

  it('replaces an error with the next cached answer', () => {
    const failed: ExplanationDisplay = { status: 'error', message: '失敗' };

    expect(nextExplanationDisplay(failed, { type: 'cacheHit', text: '説明', cachedAt: 1 })).toEqual({
      status: 'ready',
      text: '説明',
      cachedAt: 1,
    });
  });

  it('clears an error when the next request starts', () => {
    const failed: ExplanationDisplay = { status: 'error', message: '失敗' };

    expect(nextExplanationDisplay(failed, { type: 'requested', requestId: 2 })).toEqual({ status: 'loading', requestId: 2 });
  });

  it('loads again when a cached answer is regenerated', () => {
    const cached: ExplanationDisplay = { status: 'ready', text: '古い説明', cachedAt: 1 };

    expect(afterEvents([{ type: 'requested', requestId: 3 }, { type: 'answered', requestId: 3, text: '新しい説明' }], cached)).toEqual({
      status: 'ready',
      text: '新しい説明',
    });
  });
});
