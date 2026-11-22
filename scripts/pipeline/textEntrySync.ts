import { spawn } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import { isLocalDatabase } from '../db/localDatabase';
import { REPO_ROOT } from '../shared/repoPaths';

const SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'db', 'sync-text-entry.ts');

/** The text_entries row a book file is copied into. */
export interface TextEntryTarget {
  directory: string;
  fileName: string;
  filePath: string;
}

export type SyncToDatabase = (target: TextEntryTarget) => Promise<boolean>;

/** postgres.js parses the URL, with its PGHOST and PGPORT fallbacks, without connecting. */
function describeDatabase(databaseUrl: string): { hosts: string[]; label: string } {
  const { host, port, database } = postgres(databaseUrl).options;
  return { hosts: host, label: `${host.join(',')}:${port.join(',')}/${database}` };
}

// lib/db loads only under the react-server condition outside Next.js, which this process was not
// started with, so each sync runs sync-text-entry.ts in its own short-lived Node.
function runSyncScript(target: TextEntryTarget, databaseUrl: string): Promise<boolean> {
  const scriptArgs = ['--directory', target.directory, '--file-name', target.fileName, '--file', target.filePath];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=react-server', SYNC_SCRIPT, ...scriptArgs], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.once('error', (error) => {
      console.error(`    Database sync could not start: ${error.message}`);
      resolve(false);
    });
    child.once('exit', (exitCode) => resolve(exitCode === 0));
  });
}

/**
 * The per-chunk database sync: upserts the reader's file straight into text_entries, so no dev
 * server has to run. Throws before the first chunk for a database that is not on this machine.
 */
function createTextEntrySync(databaseUrl: string): SyncToDatabase {
  const database = describeDatabase(databaseUrl);
  if (!isLocalDatabase(database.hosts)) {
    throw new Error(
      `Refusing to sync chunks to ${database.hosts.join(', ')}: the book pipeline writes only to a database on localhost or 127.0.0.1. ` +
        'Push a finished book to production with npm run db:sync.',
    );
  }
  console.log(`Database sync: ${database.label}`);
  return (target) => runSyncScript(target, databaseUrl);
}

/** --database-url, else the DATABASE_URL (or POSTGRES_URL) the app uses. Without any, chunks are only saved to files. */
export function createDatabaseSync(databaseUrlOption: string | undefined, env: NodeJS.ProcessEnv = process.env): SyncToDatabase {
  const databaseUrl = databaseUrlOption || env.DATABASE_URL || env.POSTGRES_URL;
  if (databaseUrl) return createTextEntrySync(databaseUrl);
  console.warn('No --database-url or DATABASE_URL: chunks are saved to files but not synced to the database.');
  return async () => false;
}
