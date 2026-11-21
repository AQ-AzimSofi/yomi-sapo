import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Real paths on both sides, so a script started through a different drive-letter case or a junction still runs.
export function isEntryPoint(moduleUrl: string): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;
  return realpathSync.native(scriptPath) === realpathSync.native(fileURLToPath(moduleUrl));
}
