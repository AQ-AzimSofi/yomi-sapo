/**
 * Row types and the schema statements that lib/db/schemaRunner.ts applies.
 */
import type { DatabaseKind } from './connectionConfig';

export interface Bookmark {
  id?: number;
  file_name: string;
  directory: string;
  bookmark_text: string;
  updated_at?: Date;
}

export interface TextEntry {
  id?: number;
  file_name: string;
  directory: string;
  content: string;
  total_pages?: number;
  total_characters?: number;
  created_at?: Date;
}

export interface VocabularyRow {
  id: string;
  word: string;
  reading: string | null;
  sentence: string;
  file_name: string;
  directory: string;
  paragraph_text: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// Tables for a new database, in the form Aurora DSQL accepts:
// - DSQL has no SERIAL, and wants BIGINT for an identity column, which postgres.js returns as a
//   string. So an INT id defaults to a sequence with the name SERIAL would give it. DSQL allows
//   CACHE 1 or at least 65536, and 65536 would spend a block of 65536 ids per new connection.
// - UNIQUE (file_name, directory) stays inline: it is the ON CONFLICT target, DSQL cannot add a
//   constraint later, and its index already serves lookups by file_name and directory.
// A database an older schema created keeps its SERIAL ids and extra indexes; IF NOT EXISTS
// leaves its tables and their sequences alone.
const TABLE_STATEMENTS: readonly string[] = [
  `CREATE SEQUENCE IF NOT EXISTS bookmarks_id_seq CACHE 1`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
    id INT PRIMARY KEY DEFAULT nextval('bookmarks_id_seq'),
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    bookmark_text TEXT NOT NULL,
    bookmark_page INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (file_name, directory)
  )`,

  `CREATE SEQUENCE IF NOT EXISTS text_entries_id_seq CACHE 1`,
  `CREATE TABLE IF NOT EXISTS text_entries (
    id INT PRIMARY KEY DEFAULT nextval('text_entries_id_seq'),
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    total_pages INT DEFAULT 0,
    total_characters INT DEFAULT 0,
    content_bytes INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (file_name, directory)
  )`,

  // An audiobook recording paired with one text variant. It holds the S3 object key rather
  // than a URL: the recording is private, so the API signs a short-lived URL per request.
  `CREATE SEQUENCE IF NOT EXISTS narration_id_seq CACHE 1`,
  `CREATE TABLE IF NOT EXISTS narration (
    id INT PRIMARY KEY DEFAULT nextval('narration_id_seq'),
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    audio_key VARCHAR(500) NOT NULL,
    unit_count INT NOT NULL,
    cues JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (file_name, directory)
  )`,

  `CREATE TABLE IF NOT EXISTS vocabulary_entries (
    id VARCHAR(255) PRIMARY KEY,
    word VARCHAR(255) NOT NULL,
    reading VARCHAR(255),
    sentence TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    paragraph_text TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
];

// Brings tables an older schema created on PostgreSQL up to date. A DSQL database starts from
// TABLE_STATEMENTS with every column, and DSQL refuses ADD COLUMN with a DEFAULT even when the
// column exists. A later column for DSQL needs a bare ADD COLUMN, then SET DEFAULT, then a
// backfill in batches, each a separate statement.
const POSTGRES_UPGRADE_STATEMENTS: readonly string[] = [
  `ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS bookmark_page INT`,
  `ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS total_pages INT DEFAULT 0`,
  `ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS total_characters INT DEFAULT 0`,
  // Size the cached page counts were computed at; NULL means not yet counted.
  `ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS content_bytes INT`,
  // Add updated_at with no default first so existing rows stay NULL, seed them
  // from created_at (guarded by IS NULL so repeat init-db calls never overwrite
  // real write times), then set the default for future inserts. A plain
  // ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP would instead stamp every existing
  // row with the ALTER time, making one DB look uniformly newer than the other
  // and pushing/pulling all content the wrong way on the first sync.
  `ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
  `UPDATE text_entries SET updated_at = created_at WHERE updated_at IS NULL`,
  `ALTER TABLE text_entries ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP`,
];

// DSQL builds a secondary index only with CREATE INDEX ASYNC, and accepts no DESC key order.
// The runner waits for each build on DSQL and drops ASYNC on PostgreSQL.
const INDEX_STATEMENTS: readonly string[] = [
  `CREATE INDEX ASYNC IF NOT EXISTS idx_vocabulary_entries_created_at ON vocabulary_entries (created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_vocabulary_entries_word ON vocabulary_entries (word)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_vocabulary_entries_file ON vocabulary_entries (file_name, directory)`,
];

/**
 * The statements GET /api/init-db, npm run db:migrate and scripts/db/apply-schema-dsql.ts apply,
 * in order and one per call: DSQL runs one DDL statement per transaction. Each creates only what
 * does not exist yet, so running them again changes nothing.
 */
export function schemaStatementsFor(kind: DatabaseKind): readonly string[] {
  if (kind === 'dsql') return [...TABLE_STATEMENTS, ...INDEX_STATEMENTS];
  return [...TABLE_STATEMENTS, ...POSTGRES_UPGRADE_STATEMENTS, ...INDEX_STATEMENTS];
}
