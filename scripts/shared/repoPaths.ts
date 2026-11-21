import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORE_SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts', 'core');

/** Loads .env.local, then .env for anything it leaves unset, from the repo root whatever the working directory. */
export function loadRepoEnv(): void {
  dotenv.config({ path: [path.join(REPO_ROOT, '.env.local'), path.join(REPO_ROOT, '.env')] });
}
