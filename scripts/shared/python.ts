import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './repoPaths';

export interface PythonCommand {
  command: string;
  /** Arguments before the script, such as -3 for the Windows py launcher. */
  launcherArgs: string[];
}

export interface PythonLookup {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  pathExists: (filePath: string) => boolean;
}

const VENV_DIR_NAMES = ['.venv', 'venv'];

const DEFAULT_LOOKUP: PythonLookup = { env: process.env, platform: process.platform, pathExists: existsSync };

function listVenvPythons(platform: NodeJS.Platform): string[] {
  const interpreterPath = platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  return VENV_DIR_NAMES.map((venvDirName) => path.join(REPO_ROOT, venvDirName, ...interpreterPath));
}

/** PYTHON from the environment, then a venv in the repo root, then the py launcher on Windows or python3 elsewhere. */
export function resolvePython(lookup: PythonLookup = DEFAULT_LOOKUP): PythonCommand {
  if (lookup.env.PYTHON) return { command: lookup.env.PYTHON, launcherArgs: [] };
  const venvPython = listVenvPythons(lookup.platform).find(lookup.pathExists);
  if (venvPython) return { command: venvPython, launcherArgs: [] };
  if (lookup.platform === 'win32') return { command: 'py', launcherArgs: ['-3'] };
  return { command: 'python3', launcherArgs: [] };
}

export function describePython(python: PythonCommand): string {
  return [python.command, ...python.launcherArgs].join(' ');
}

export interface PythonRunOptions {
  /** Keep stderr for the error message instead of showing it as it is written. */
  isStderrCaptured?: boolean;
}

/**
 * Runs the resolved Python with args from the repo root and returns its stdout. Throws when Python
 * cannot start or exits non-zero. stdin stays the console's, and stderr is shown live unless captured.
 */
export function runPython(args: string[], options: PythonRunOptions = {}): string {
  const python = resolvePython();
  const result = spawnSync(python.command, [...python.launcherArgs, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    // A pipe gets the Windows code page by default, which garbles Japanese and fails on characters outside it.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['inherit', 'pipe', options.isStderrCaptured ? 'pipe' : 'inherit'],
  });
  const commandLine = `${describePython(python)} ${path.basename(args[0] ?? '')}`;
  if (result.error) throw new Error(`${commandLine} could not run: ${result.error.message}`);
  if (result.status === 0) return result.stdout;
  const exitReason = result.status === null ? `was stopped by ${result.signal}` : `exited with ${result.status}`;
  const stderr = options.isStderrCaptured ? `: ${result.stderr.trim()}` : '';
  throw new Error(`${commandLine} ${exitReason}${stderr}`);
}

// Every Python step needs MeCab; finding out before the first chunk beats a furigana step that fails hours in.
export function assertPythonHasMeCab(): void {
  try {
    runPython(['-c', 'import MeCab'], { isStderrCaptured: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Python cannot import MeCab (${reason}). ` +
        'Install the Python dependencies (pip install -r scripts/requirements.txt) or set PYTHON to an interpreter that has them.',
    );
  }
}
