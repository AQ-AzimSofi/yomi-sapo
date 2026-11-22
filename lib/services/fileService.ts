import 'server-only';
import * as fs from 'fs/promises';
import path from 'path';

// A literal 'public' lets Next's file tracer scope this module to public/;
// an imported constant made it trace the whole repo into every route that loads this module.
const PUBLIC_ROOT = path.join(process.cwd(), 'public');

function publicFilePath(fileName: string): string {
  return path.join(PUBLIC_ROOT, fileName);
}

export async function readTextFile(fileName: string): Promise<string> {
  const flatPath = publicFilePath(`${fileName}.txt`);

  try {
    return await fs.readFile(flatPath, 'utf8');
  } catch {
    const parts = fileName.split('/');
    const baseFileName = parts[parts.length - 1];
    const nestedPath = publicFilePath(`${fileName}/${baseFileName}.txt`);

    try {
      return await fs.readFile(nestedPath, 'utf8');
    } catch {
      return '';
    }
  }
}
