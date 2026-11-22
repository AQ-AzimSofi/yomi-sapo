import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { REPO_ROOT } from '../shared/repoPaths';

function runAwsS3(args: string[]): boolean {
  const result = spawnSync('aws', ['s3', ...args], { stdio: 'inherit' });
  if (result.status === 0) {
    return true;
  }
  console.error(`aws s3 ${args[0]} failed: ${result.error?.message ?? `exit code ${result.status}`}`);
  return false;
}

// public/<outputDir> is gitignored, so illustrations never reach the deployed app on
// their own; the reader loads them from this bucket through /api/book-assets.
// Exact paths rather than --include filters: the CLI matches filters against the
// unescaped absolute path, so a book name with [ or ] would make every filter miss.
export function uploadBookImages(outputDir: string, bookName: string, isDryRun: boolean): void {
  const bucket = process.env.BOOK_IMAGES_BUCKET;
  if (!bucket) {
    console.warn('BOOK_IMAGES_BUCKET is not set in .env.local; skipping. Illustrations will not show until uploaded.');
    return;
  }

  const bookPrefix = `${outputDir}/${bookName}`;
  const localBookDir = path.join(REPO_ROOT, 'public', bookPrefix);
  const imagesDir = path.join(localBookDir, 'images');
  const metadataPath = path.join(localBookDir, `${bookName}.json`);
  const modeFlag = isDryRun ? '--dryrun' : '--only-show-errors';

  const uploads = [
    { localPath: imagesDir, args: ['sync', imagesDir, `s3://${bucket}/${bookPrefix}/images/`] },
    { localPath: metadataPath, args: ['cp', metadataPath, `s3://${bucket}/${bookPrefix}/${bookName}.json`] },
  ].filter((upload) => fs.existsSync(upload.localPath));
  const failedUploads = uploads.filter((upload) => !runAwsS3([...upload.args, modeFlag]));

  if (failedUploads.length > 0) {
    console.error('Illustration upload failed; rerun the README "Book Illustrations" sync once fixed.');
    return;
  }
  console.log(`${isDryRun ? 'Would upload' : 'Uploaded'} illustrations to s3://${bucket}/${bookPrefix}/`);
}
