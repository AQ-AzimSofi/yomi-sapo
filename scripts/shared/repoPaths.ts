import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Loads .env.local, then .env for anything it leaves unset, from the repo root whatever the working directory. */
export function loadRepoEnv(): void {
  dotenv.config({ path: [path.join(REPO_ROOT, '.env.local'), path.join(REPO_ROOT, '.env')] });
}
