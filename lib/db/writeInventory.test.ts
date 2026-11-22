import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DB_DIR = fileURLToPath(new URL('.', import.meta.url));
// sync-core writes through pg for the dev sync tools, and schema.ts holds the statements that schemaRunner.ts applies.
const NOT_APP_QUERY_MODULES = ['sync-core.ts', 'schema.ts', 'schemaRunner.ts', 'writeTransaction.ts'];
// A tagged template, or sql.unsafe with its statement inline; a WITH counts when it holds a write.
const AUTOCOMMIT_WRITE = /\bsql(?:`|\.unsafe\(\s*[`'"])\s*(?:WITH\b[^`]*?)?\b(INSERT|UPDATE|DELETE)\b/gi;
// sql.unsafe with a statement held elsewhere, which the check above cannot read.
const UNCHECKED_UNSAFE = /\bsql\.unsafe\(\s*(?![`'"])/g;
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
    expect(appQueryModules()).toEqual(expect.arrayContaining(['queries.ts', 'libraryProgressQueries.sql.ts', 'narrationQueries.sql.ts', 'rubyRegistryQueries.sql.ts', 'vocabularyQueries.sql.ts']));
  });

  it.each([
    'await sql`\n  DELETE FROM bookmarks`',
    "await sql.unsafe('DELETE FROM vocabulary_entries WHERE id = $1', [id])",
    'await sql`WITH gone AS (DELETE FROM bookmarks RETURNING id) SELECT count(*) FROM gone`',
  ])('recognises an autocommit write: %s', (statement) => {
    expect(statement.match(AUTOCOMMIT_WRITE)).toHaveLength(1);
  });

  it.each([
    'await sql`SELECT updated_at FROM bookmarks`',
    'await sql`WITH recent AS (SELECT id FROM bookmarks) SELECT * FROM recent`',
    'await tx`DELETE FROM bookmarks`',
  ])('lets a read or a write in a transaction through: %s', (statement) => {
    expect(statement.match(AUTOCOMMIT_WRITE)).toBeNull();
  });

  it('never writes with an autocommit sql statement', () => {
    expect(findInQueryModules(AUTOCOMMIT_WRITE)).toEqual([]);
  });

  it('never runs a statement it cannot read through sql.unsafe', () => {
    expect(findInQueryModules(UNCHECKED_UNSAFE)).toEqual([]);
  });

  it('never opens a transaction that is not retried on a conflict', () => {
    expect(findInQueryModules(UNRETRIED_TRANSACTION)).toEqual([]);
  });
});
