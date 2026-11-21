import { sql } from './connection';
import type { Bookmark, TextEntry, QueryResult } from './schema';

function normalizeResult<T>(result: QueryResult<T>): T[] {
  if (result && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows;
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}

export async function getBookmark(
  fileName: string,
  directory: string = 'public'
): Promise<string> {
  try {
    const result = await sql<Pick<Bookmark, 'bookmark_text'>>`
      SELECT bookmark_text
      FROM bookmarks
      WHERE file_name = ${fileName} AND directory = ${directory}
    `;

    const rows = normalizeResult(result);
    if (rows.length === 0) {
      return '';
    }

    return rows[0].bookmark_text;
  } catch (error) {
    console.error('Error fetching bookmark:', error);
    throw error;
  }
}

interface BookmarkWrite {
  fileName: string;
  directory: string;
  bookmarkText: string;
  bookmarkPage?: number;
}

/**
 * Saves a bookmark with the reader page it sits on. Without a page,
 * bookmark_page is cleared and the library works it out from the text.
 */
export async function upsertBookmark({ fileName, directory, bookmarkText, bookmarkPage }: BookmarkWrite): Promise<void> {
  const page = bookmarkPage ?? null;
  try {
    await sql`
      INSERT INTO bookmarks (file_name, directory, bookmark_text, bookmark_page, updated_at)
      VALUES (${fileName}, ${directory}, ${bookmarkText}, ${page}, CURRENT_TIMESTAMP)
      ON CONFLICT (file_name, directory)
      DO UPDATE SET
        bookmark_text = EXCLUDED.bookmark_text,
        bookmark_page = EXCLUDED.bookmark_page,
        updated_at = CURRENT_TIMESTAMP
    `;
  } catch (error) {
    console.error('Error upserting bookmark:', error);
    throw error;
  }
}

export async function initializeBookmarksForFiles(
  fileNames: string[],
  directory: string = 'public'
): Promise<void> {
  try {
    const existing = await sql<Pick<Bookmark, 'file_name'>>`
      SELECT file_name FROM bookmarks WHERE directory = ${directory}
    `;

    const rows = normalizeResult(existing);
    const existingFiles = new Set(rows.map((row) => row.file_name));

    for (const fileName of fileNames) {
      if (!existingFiles.has(fileName)) {
        await sql`
          INSERT INTO bookmarks (file_name, directory, bookmark_text)
          VALUES (${fileName}, ${directory}, '')
          ON CONFLICT (file_name, directory) DO NOTHING
        `;
      }
    }
  } catch (error) {
    console.error('Error initializing bookmarks:', error);
    throw error;
  }
}

/**
 * A cheap fingerprint of a book's stored text, or null when the book is missing.
 * octet_length reads the TOAST header, so the text itself is never loaded.
 * GREATEST (which skips NULLs) also catches rewrites that only bump created_at.
 */
export async function getTextEntryVersion(fileName: string, directory: string): Promise<string | null> {
  const result = await sql<{ bytes: number; updated_ms: string }>`
    SELECT octet_length(content) AS bytes,
           FLOOR(EXTRACT(EPOCH FROM GREATEST(updated_at, created_at)) * 1000)::bigint AS updated_ms
    FROM text_entries
    WHERE file_name = ${fileName} AND directory = ${directory}
  `;
  const rows = normalizeResult(result);
  return rows.length === 0 ? null : `${rows[0].bytes}-${rows[0].updated_ms}`;
}

export async function getTextEntry(
  fileName: string,
  directory: string = 'public'
): Promise<string> {
  try {
    const result = await sql<Pick<TextEntry, 'content'>>`
      SELECT content
      FROM text_entries
      WHERE file_name = ${fileName} AND directory = ${directory}
    `;

    const rows = normalizeResult(result);
    if (rows.length === 0) {
      return '';
    }

    return rows[0].content;
  } catch (error) {
    console.error('Error fetching text entry:', error);
    throw error;
  }
}

export async function upsertTextEntry(
  fileName: string,
  content: string,
  directory: string = 'public'
): Promise<void> {
  try {
    await sql`
      INSERT INTO text_entries (file_name, directory, content, created_at, updated_at)
      VALUES (${fileName}, ${directory}, ${content}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (file_name, directory)
      DO UPDATE SET
        content = ${content},
        updated_at = CURRENT_TIMESTAMP
    `;
  } catch (error) {
    console.error('Error upserting text entry:', error);
    throw error;
  }
}

export async function getAllTextEntries(): Promise<{
  directories: string[];
  filesByDirectory: Record<string, string[]>;
}> {
  try {
    const result = await sql<Pick<TextEntry, 'directory' | 'file_name'>>`
      SELECT DISTINCT directory, file_name
      FROM text_entries
      ORDER BY directory, file_name
    `;

    const rows = normalizeResult(result);
    const filesByDirectory: Record<string, string[]> = {};
    const directoriesSet = new Set<string>();

    rows.forEach((row) => {
      const dir = row.directory;
      const fileName = row.file_name;

      directoriesSet.add(dir);

      if (!filesByDirectory[dir]) {
        filesByDirectory[dir] = [];
      }
      filesByDirectory[dir].push(fileName);
    });

    const directories = Array.from(directoriesSet).sort((a, b) => {
      if (a === 'bookv2-furigana') return -1;
      if (b === 'bookv2-furigana') return 1;
      return a.localeCompare(b);
    });

    return {
      directories,
      filesByDirectory,
    };
  } catch (error) {
    console.error('Error fetching all text entries:', error);
    throw error;
  }
}

export async function backfillTextMetadata(): Promise<number> {
  return 0;
}

