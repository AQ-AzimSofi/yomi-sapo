import * as fs from 'fs';
import * as path from 'path';
import { describePython, resolvePython, runPython } from '../shared/python';
import { CORE_SCRIPTS_DIR, REPO_ROOT } from '../shared/repoPaths';

export function extractEpub(epubPath: string, libraryDir: string, filter: string): string | null {
  const scriptArgs = [
    path.join(CORE_SCRIPTS_DIR, 'epub-to-text-furigana.py'),
    epubPath,
    ...(filter === 'n3' ? ['--filter', 'n3'] : []),
    '--output', libraryDir,
  ];

  console.log(`Running: ${describePython(resolvePython())} ${scriptArgs.join(' ')}\n`);

  try {
    runPython(scriptArgs);

    // Find the created book directory
    const dirs = fs.readdirSync(libraryDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    // Find most recently created directory (the one we just made)
    let newestDir = '';
    let newestTime = 0;

    for (const dir of dirs) {
      const dirPath = path.join(libraryDir, dir);
      const stat = fs.statSync(dirPath);
      if (stat.mtimeMs > newestTime) {
        newestTime = stat.mtimeMs;
        newestDir = dir;
      }
    }

    if (newestDir) {
      console.log(`\nExtracted to: ${newestDir}`);
      return newestDir;
    }

    return null;
  } catch (error) {
    console.error('Error running epub extraction:', error);
    return null;
  }
}

// ============================================================================
// Ruby Registry Extraction
// ============================================================================

export function extractRubyRegistry(epubPath: string): boolean {
  // Create temp directory and copy EPUB there for extract-ruby-smart.py
  const tempDir = path.join(REPO_ROOT, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const epubName = path.basename(epubPath);
  const tempEpubPath = path.join(tempDir, epubName);

  // Copy EPUB to temp
  fs.copyFileSync(epubPath, tempEpubPath);
  console.log(`Copied EPUB to: ${tempEpubPath}`);

  try {
    runPython([path.join(CORE_SCRIPTS_DIR, 'extract-ruby-smart.py')]);

    // Clean up temp file
    if (fs.existsSync(tempEpubPath)) {
      fs.unlinkSync(tempEpubPath);
    }

    return true;
  } catch (error) {
    console.error('Error extracting ruby registry:', error);
    // Clean up on error
    if (fs.existsSync(tempEpubPath)) {
      fs.unlinkSync(tempEpubPath);
    }
    return false;
  }
}
