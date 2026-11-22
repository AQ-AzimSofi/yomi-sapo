import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPython } from '../shared/python';
import { CORE_SCRIPTS_DIR, REPO_ROOT } from '../shared/repoPaths';
import { hasPythonBookPackages } from './fixtures/tinyEpub';

const PRINT_DEFAULT_OUTPUT_DIR = [
  'import importlib.util, sys',
  'sys.path.insert(0, sys.argv[1])',
  "spec = importlib.util.spec_from_file_location('extractor', sys.argv[2])",
  'extractor = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(extractor)',
  'print(extractor.DEFAULT_OUTPUT_DIR)',
].join('\n');

describe.skipIf(!hasPythonBookPackages())('epub-to-text-furigana.py run on its own', () => {
  it('Test_DefaultOutputDir_IsTheRepoPublicFolder', () => {
    const extractorPath = path.join(CORE_SCRIPTS_DIR, 'epub-to-text-furigana.py');
    const defaultOutputDir = runPython(['-c', PRINT_DEFAULT_OUTPUT_DIR, CORE_SCRIPTS_DIR, extractorPath]).trim();
    expect(path.resolve(defaultOutputDir)).toBe(path.join(REPO_ROOT, 'public', 'bookv2-furigana'));
  });
});
