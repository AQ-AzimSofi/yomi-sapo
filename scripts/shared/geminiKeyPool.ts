import { ApiError, GoogleGenAI } from '@google/genai';

const FREE_API_KEY_ENV_NAMES = ['GEMINI_API_KEY', 'GEMINI_API_KEY2', 'GEMINI_API_KEY3', 'GEMINI_API_KEY4', 'GEMINI_API_KEY5'];
export const PAID_API_KEY_ENV_NAME = 'GEMINI_API_KEY_PAID';

export interface ApiKey {
  envName: string;
  client: GoogleGenAI;
}

export interface KeyPool {
  freeKeys: ApiKey[];
  paidKey?: ApiKey;
  // Free keys out of daily quota or rejected, skipped for the rest of the run.
  retiredFreeKeys: Set<ApiKey>;
}

function readApiKey(envName: string): ApiKey | undefined {
  const apiKey = process.env[envName];
  if (!apiKey) return undefined;
  return { envName, client: new GoogleGenAI({ apiKey }) };
}

export function createKeyPool(): KeyPool {
  const freeKeys = FREE_API_KEY_ENV_NAMES.map(readApiKey).filter((key): key is ApiKey => key !== undefined);
  const paidKey = readApiKey(PAID_API_KEY_ENV_NAME);
  if (freeKeys.length === 0 && !paidKey) {
    throw new Error(`No Gemini API key found. Set ${FREE_API_KEY_ENV_NAMES.join(' / ')} in .env.local or ${PAID_API_KEY_ENV_NAME}.`);
  }
  return { freeKeys, paidKey, retiredFreeKeys: new Set() };
}

export function pickKey(keyPool: KeyPool, spreadIndex: number): ApiKey | undefined {
  const availableFreeKeys = keyPool.freeKeys.filter((key) => !keyPool.retiredFreeKeys.has(key));
  if (availableFreeKeys.length === 0) return keyPool.paidKey;
  return availableFreeKeys[spreadIndex % availableFreeKeys.length];
}

/** Why the key that made the request can serve nothing more this run, or undefined when the error is not about the key. */
export function describeUnusableKey(error: unknown, model: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  // A per-minute limit clears by itself; a per-day quota or a rejected key does not.
  if (error.status === 429 && error.message.includes('PerDay')) return `out of daily quota for ${model}`;
  if (error.status === 403 || error.message.includes('API_KEY_INVALID')) return `rejected (${describeError(error)})`;
  return undefined;
}

export function isRetryable(error: unknown): boolean {
  // Network failures and blocked (empty) replies are not ApiErrors and can pass on a retry; any other 4xx, such as an unknown model, cannot.
  if (!(error instanceof ApiError)) return true;
  return error.status === 429 || error.status >= 500;
}

function describeFallback(keyPool: KeyPool): string {
  const remainingFreeKeyCount = keyPool.freeKeys.length - keyPool.retiredFreeKeys.size;
  if (remainingFreeKeyCount > 0) return `${remainingFreeKeyCount} free key(s) left`;
  if (keyPool.paidKey) return `switching to ${keyPool.paidKey.envName}`;
  return `no ${PAID_API_KEY_ENV_NAME} to fall back to`;
}

export function retireKey(keyPool: KeyPool, key: ApiKey, reason: string): void {
  // Concurrent workers can hit the same key; report it once.
  if (keyPool.retiredFreeKeys.has(key)) return;
  keyPool.retiredFreeKeys.add(key);
  console.log(`  ${key.envName} is ${reason}; ${describeFallback(keyPool)}`);
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Gemini API errors are a JSON body; the first line of its "message" field is the readable part.
  return /"message":"([^"\\]*)/.exec(message)?.[1]?.trim() ?? message;
}
