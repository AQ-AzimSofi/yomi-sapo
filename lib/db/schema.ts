/**
 * Row types and the schema SQL that GET /api/init-db and npm run db:migrate apply.
 */

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

/**
 * Creates every table and index that does not exist yet.
 */
export const CREATE_TABLES_SQL = `
  -- Bookmarks table
  CREATE TABLE IF NOT EXISTS bookmarks (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    bookmark_text TEXT NOT NULL,
    bookmark_page INT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_name, directory)
  );
  ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS bookmark_page INT;

  -- Create index for faster lookups
  CREATE INDEX IF NOT EXISTS idx_bookmarks_file_directory
    ON bookmarks(file_name, directory);

  -- Text entries table (for user-generated content)
  CREATE TABLE IF NOT EXISTS text_entries (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    total_pages INT DEFAULT 0,
    total_characters INT DEFAULT 0,
    content_bytes INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_name, directory)
  );

  -- Create index for faster lookups
  CREATE INDEX IF NOT EXISTS idx_text_entries_file_directory
    ON text_entries(file_name, directory);

  -- Narration table (audiobook recording paired with one text variant)
  -- Holds the S3 object key rather than a URL: the recording is private, so the
  -- API signs a short-lived URL per request instead of storing a durable one.
  CREATE TABLE IF NOT EXISTS narration (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    directory VARCHAR(255) NOT NULL,
    audio_key VARCHAR(500) NOT NULL,
    unit_count INT NOT NULL,
    cues JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_name, directory)
  );

  CREATE INDEX IF NOT EXISTS idx_narration_file_directory
    ON narration(file_name, directory);

  -- Vocabulary entries table (user vocabulary diary)
  CREATE TABLE IF NOT EXISTS vocabulary_entries (
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
  );
  CREATE INDEX IF NOT EXISTS idx_vocabulary_entries_created_at ON vocabulary_entries(created_at);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_entries_word ON vocabulary_entries(word);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_entries_file ON vocabulary_entries(file_name, directory);
`;

/**
 * Runs after CREATE_TABLES_SQL to bring tables an older schema created up to date.
 * Every statement is safe to run again.
 */
export const MIGRATIONS_SQL = `
  ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS total_pages INT DEFAULT 0;
  ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS total_characters INT DEFAULT 0;
  -- Size the cached page counts were computed at; NULL means not yet counted.
  ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS content_bytes INT;
  -- Add updated_at with no default first so existing rows stay NULL, seed them
  -- from created_at (guarded by IS NULL so repeat init-db calls never overwrite
  -- real write times), then set the default for future inserts. A plain
  -- ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP would instead stamp every existing
  -- row with the ALTER time, making one DB look uniformly newer than the other
  -- and pushing/pulling all content the wrong way on the first sync.
  ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
  UPDATE text_entries SET updated_at = created_at WHERE updated_at IS NULL;
  ALTER TABLE text_entries ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
`;
