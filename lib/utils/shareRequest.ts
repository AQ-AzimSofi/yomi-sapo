/**
 * Gives every caller asking for the same key while a request is out that one
 * request's promise, so a paid call is never made twice for the same thing. The
 * key is forgotten once the request settles, so a failure can be retried.
 */
export function shareRequest<T>(pending: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = start().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
