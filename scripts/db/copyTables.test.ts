import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compareRows,
  COPY_TABLES,
  deleteRowSql,
  planTableShapes,
  selectRowsSql,
  setSequenceSql,
  upsertRowSql,
  upsertRowValues,
  type Catalog,
  type CatalogColumn,
  type CopyTableSpec,
  type TableShape,
} from './copyTables';

const BOOKMARKS_SPEC: CopyTableSpec = { name: 'bookmarks', keyColumns: ['id'] };

function column(table: string, name: string, type: string, columnDefault: string | null = null): CatalogColumn {
  return { table, column: name, type, columnDefault };
}

const TARGET_BOOKMARK_COLUMNS = [
  column('bookmarks', 'id', 'int4', "nextval('bookmarks_id_seq'::regclass)"),
  column('bookmarks', 'file_name', 'varchar'),
  column('bookmarks', 'updated_at', 'timestamp', 'CURRENT_TIMESTAMP'),
];
const TARGET: Catalog = { tables: ['bookmarks'], columns: TARGET_BOOKMARK_COLUMNS };
// A database an older schema created: text instead of varchar, columns in another order, and the old Prisma tables.
const SOURCE: Catalog = {
  tables: ['Book', 'bookmarks'],
  columns: [
    column('bookmarks', 'file_name', 'text'),
    column('bookmarks', 'id', 'int4', "nextval('bookmarks_id_seq'::regclass)"),
    column('bookmarks', 'updated_at', 'timestamp'),
    column('Book', 'id', 'text'),
  ],
};

function bookmarksShape(): TableShape {
  return planTableShapes([BOOKMARKS_SPEC], SOURCE, TARGET)[0];
}

describe('COPY_TABLES', () => {
  it('covers every table the app writes', () => {
    expect(COPY_TABLES.map((spec) => spec.name)).toEqual(['bookmarks', 'text_entries', 'narration', 'vocabulary_entries']);
  });

  it('copies content_bytes only while it matches the book text', () => {
    const textEntries = COPY_TABLES.find((spec) => spec.name === 'text_entries');

    expect(textEntries?.prepareRow?.({ id: '1', content: 'あ', content_bytes: '9' }).content_bytes).toBeNull();
  });

  it('refuses a book too large for one DSQL value and accepts a small one', () => {
    const textEntries = COPY_TABLES.find((spec) => spec.name === 'text_entries');
    const incompressible = randomBytes(900_000).toString('base64');

    expect(textEntries?.refusalOf?.({ id: '1', content: 'あ' })).toBeNull();
    expect(textEntries?.refusalOf?.({ id: '1', content: incompressible })).toMatch(/too large/);
  });
});

describe('planTableShapes', () => {
  it('takes the columns, their types and their sequences from the target', () => {
    expect(bookmarksShape()).toEqual({
      spec: BOOKMARKS_SPEC,
      columns: [
        { name: 'id', type: 'int4' },
        { name: 'file_name', type: 'varchar' },
        { name: 'updated_at', type: 'timestamp' },
      ],
      sequences: [{ column: 'id', sequence: 'bookmarks_id_seq' }],
    });
  });

  it('refuses a target table that COPY_TABLES does not list, such as a table added later', () => {
    const target = { tables: ['bookmarks', 'ruby_registry'], columns: TARGET_BOOKMARK_COLUMNS };

    expect(() => planTableShapes([BOOKMARKS_SPEC], SOURCE, target)).toThrow(/ruby_registry, which COPY_TABLES/);
  });

  it('refuses a target without the table', () => {
    expect(() => planTableShapes([BOOKMARKS_SPEC], SOURCE, { tables: [], columns: [] })).toThrow(/apply the schema first/);
  });

  it('refuses a source column the target lacks, which the copy would drop', () => {
    const source = { ...SOURCE, columns: [...SOURCE.columns, column('bookmarks', 'bookmark_page', 'int4')] };

    expect(() => planTableShapes([BOOKMARKS_SPEC], source, TARGET)).toThrow(/target has no column bookmarks.bookmark_page/);
  });

  it('refuses a target column the source lacks', () => {
    const target = { ...TARGET, columns: [...TARGET_BOOKMARK_COLUMNS, column('bookmarks', 'bookmark_page', 'int4')] };

    expect(() => planTableShapes([BOOKMARKS_SPEC], SOURCE, target)).toThrow(/source has no column bookmarks.bookmark_page/);
  });
});

describe('statements', () => {
  it('reads every column as text, in key order', () => {
    expect(selectRowsSql(bookmarksShape())).toBe(
      'SELECT "id"::text AS "id", "file_name"::text AS "file_name", "updated_at"::text AS "updated_at" FROM "bookmarks" ORDER BY "id"'
    );
  });

  it('upserts on the key, casting each text value to the column type', () => {
    expect(upsertRowSql(bookmarksShape())).toBe(
      'INSERT INTO "bookmarks" ("id", "file_name", "updated_at") VALUES ($1::text::int4, $2::text::varchar, $3::text::timestamp) ' +
        'ON CONFLICT ("id") DO UPDATE SET "file_name" = EXCLUDED."file_name", "updated_at" = EXCLUDED."updated_at"'
    );
  });

  it('sends the values in column order, NULL included', () => {
    expect(upsertRowValues(bookmarksShape(), { updated_at: null, id: '7', file_name: 'a' })).toEqual(['7', 'a', null]);
  });

  it('deletes by key', () => {
    expect(deleteRowSql(bookmarksShape())).toBe('DELETE FROM "bookmarks" WHERE "id" = $1::text::int4');
  });

  it('moves the sequence to one past the largest id', () => {
    const shape = bookmarksShape();

    expect(setSequenceSql(shape, shape.sequences[0])).toBe(
      `SELECT setval('bookmarks_id_seq', (SELECT coalesce(max("id"), 0) + 1 FROM "bookmarks"), false)`
    );
  });
});

describe('compareRows', () => {
  const row = (id: string, fileName: string) => ({ id, file_name: fileName, updated_at: '2026-11-21 10:00:00.123456' });

  it('counts rows that match in every column as identical', () => {
    expect(compareRows(bookmarksShape(), [row('1', 'a'), row('2', 'b')], [row('2', 'b'), row('1', 'a')])).toEqual({
      table: 'bookmarks',
      expected: 2,
      actual: 2,
      identical: 2,
      missing: [],
      extra: [],
      different: [],
    });
  });

  it('names missing, extra and different rows by key', () => {
    const comparison = compareRows(bookmarksShape(), [row('1', 'a'), row('2', 'b')], [row('2', 'B'), row('3', 'c')]);

    expect(comparison).toMatchObject({ identical: 0, missing: ['["1"]'], extra: ['["3"]'], different: ['["2"]'] });
  });

  it('tells a timestamp shifted by the time zone apart', () => {
    const shifted = { ...row('1', 'a'), updated_at: '2026-11-21 01:00:00.123456' };

    expect(compareRows(bookmarksShape(), [row('1', 'a')], [shifted]).different).toEqual(['["1"]']);
  });
});
