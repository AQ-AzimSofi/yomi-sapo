/**
 * Database schema definitions for Vercel Postgres
 */

/**
 * Query result type that handles both Vercel Postgres and standard postgres
 * - Vercel Postgres returns: {rows: T[]}
 * - Standard postgres returns: T[] directly
 */
export type QueryResult<T> = T[] | { rows: T[] };

/**
 * SQL client type compatible with both libraries
 * Using any for values parameter to accommodate both Vercel Postgres and standard postgres
 */
export type SqlClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <T>(strings: TemplateStringsArray, ...values: any[]): Promise<QueryResult<T>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe?: (query: string) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query?: (query: string) => Promise<any>;
};

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

export interface VocabularyEntry {
  id: string;
  word: string;
  reading?: string;
  sentence: string;
  file_name: string;
  directory: string;
  paragraph_text?: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * SQL schema for creating tables
 * Run this in Vercel Postgres dashboard or via migration script
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
