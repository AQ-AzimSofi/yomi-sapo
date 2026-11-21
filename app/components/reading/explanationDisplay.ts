/**
 * What the explanation sidebar shows. One value, so an answer and an error can
 * never both be set, and an answer for a request the reader has since moved on
 * from can never replace what belongs to the current one.
 */
export type ExplanationDisplay =
  | { status: 'idle' }
  | { status: 'loading'; requestId: number }
  | { status: 'ready'; text: string; cachedAt?: number }
  | { status: 'error'; message: string };

export type ExplanationEvent =
  | { type: 'cacheHit'; text: string; cachedAt: number }
  | { type: 'requested'; requestId: number }
  | { type: 'answered'; requestId: number; text: string }
  | { type: 'failed'; requestId: number; message: string };

export const IDLE_EXPLANATION: ExplanationDisplay = { status: 'idle' };

function isWaitingFor(display: ExplanationDisplay, requestId: number): boolean {
  return display.status === 'loading' && display.requestId === requestId;
}

export function nextExplanationDisplay(display: ExplanationDisplay, event: ExplanationEvent): ExplanationDisplay {
  switch (event.type) {
    case 'cacheHit':
      return { status: 'ready', text: event.text, cachedAt: event.cachedAt };
    case 'requested':
      return { status: 'loading', requestId: event.requestId };
    case 'answered':
      return isWaitingFor(display, event.requestId) ? { status: 'ready', text: event.text } : display;
    case 'failed':
      return isWaitingFor(display, event.requestId) ? { status: 'error', message: event.message } : display;
  }
}
