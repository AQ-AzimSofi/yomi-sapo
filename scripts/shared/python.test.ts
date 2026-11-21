import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePython, type PythonLookup } from './python';
import { REPO_ROOT } from './repoPaths';

function createLookup(overrides: Partial<PythonLookup>): PythonLookup {
  return { env: {}, platform: 'win32', pathExists: () => false, ...overrides };
}

describe('resolvePython', () => {
  it('Test_resolvePython_PythonEnvWins', () => {
    const lookup = createLookup({ env: { PYTHON: 'C:/Python312/python.exe' }, pathExists: () => true });
    expect(resolvePython(lookup)).toEqual({ command: 'C:/Python312/python.exe', launcherArgs: [] });
  });

  it('Test_resolvePython_RepoVenvOnWindows', () => {
    const venvPython = path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
    const lookup = createLookup({ pathExists: (filePath) => filePath === venvPython });
    expect(resolvePython(lookup)).toEqual({ command: venvPython, launcherArgs: [] });
  });

  it('Test_resolvePython_RepoVenvElsewhere', () => {
    const venvPython = path.join(REPO_ROOT, 'venv', 'bin', 'python');
    const lookup = createLookup({ platform: 'linux', pathExists: (filePath) => filePath === venvPython });
    expect(resolvePython(lookup).command).toBe(venvPython);
  });

  it('Test_resolvePython_PyLauncherOnWindows', () => {
    expect(resolvePython(createLookup({}))).toEqual({ command: 'py', launcherArgs: ['-3'] });
  });

  it('Test_resolvePython_Python3Elsewhere', () => {
    expect(resolvePython(createLookup({ platform: 'darwin' }))).toEqual({ command: 'python3', launcherArgs: [] });
  });
});
