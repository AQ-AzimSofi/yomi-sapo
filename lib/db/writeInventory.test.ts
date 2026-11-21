import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DB_DIR = fileURLToPath(new URL('.', import.meta.url));
// sync-core writes through pg for the dev sync tools, and schema.ts is the DDL that init-db and db:migrate run.
const NOT_APP_QUERY_MODULES = ['sync-core.ts', 'schema.ts', 'writeTransaction.ts'];
const AUTOCOMMIT_WRITE = /\bsql`\s*(INSERT|UPDATE|DELETE)\b/gi;
const UNRETRIED_TRANSACTION = /\bsql\.begin\(/g;

function appQueryModules(): string[] {
  return readdirSync(DB_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .filter((name) => !NOT_APP_QUERY_MODULES.includes(name))
    .sort();
}

function findInQueryModules(pattern: RegExp): string[] {
  return appQueryModules().flatMap((name) =>
    [...readFileSync(path.join(DB_DIR, name), 'utf8').matchAll(pattern)].map((match) => `${name}: ${match[0]}`)
  );
}

// On Aurora DSQL an autocommit write can be lost without an error (see writeTransaction.ts),
// so every write runs on the transaction runWriteTransaction hands out.
describe('lib/db writes', () => {
  it('checks the app query modules', () => {
    expect(appQueryModules()).toEqual(expect.arrayContaining(['queries.ts', 'libraryProgressQueries.sql.ts', 'narrationQueries.sql.ts', 'vocabularyQueries.sql.ts']));
  });

  it('recognises an autocommit write', () => {
    expect('await sql`\n  DELETE FROM bookmarks`'.match(AUTOCOMMIT_WRITE)).toHaveLength(1);
  });

  it('never writes with an autocommit sql statement', () => {
    expect(findInQueryModules(AUTOCOMMIT_WRITE)).toEqual([]);
  });

  it('never opens a transaction that is not retried on a conflict', () => {
    expect(findInQueryModules(UNRETRIED_TRANSACTION)).toEqual([]);
  });
});
