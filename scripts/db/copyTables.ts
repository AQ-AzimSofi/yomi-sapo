import { createHash } from 'node:crypto';
import { bookTextTooLargeError } from '../../lib/db/bookTextSize';
import { withCurrentContentBytes } from '../../lib/db/contentBytes';

/** A row with every value as PostgreSQL prints it (::text), so timestamps and jsonb travel unchanged. */
export type TextRow = Record<string, string | null>;

export interface CopyTableSpec {
  name: string;
  // The target's ON CONFLICT key, and how rows of the two databases are matched.
  keyColumns: readonly string[];
  // Turns a source row into the row the target must hold.
  prepareRow?: (row: TextRow) => TextRow;
  // Why the target cannot store the row, or null when it can.
  refusalOf?: (row: TextRow) => string | null;
}

/**
 * Every table the copy carries. The copy refuses to run while the target has a table that is not
 * listed here, so a table added to lib/db/schema.ts later (the ruby registry, say) cannot be left
 * behind: add an entry for it. The columns and their types come from the target's catalog.
 */
export const COPY_TABLES: readonly CopyTableSpec[] = [
  { name: 'bookmarks', keyColumns: ['id'] },
  {
    name: 'text_entries',
    keyColumns: ['id'],
    prepareRow: withCurrentContentBytes,
    refusalOf: (row) => bookTextTooLargeError(row.content ?? '')?.message ?? null,
  },
  { name: 'narration', keyColumns: ['id'] },
  { name: 'vocabulary_entries', keyColumns: ['id'] },
];

export interface CatalogColumn {
  table: string;
  column: string;
  // information_schema udt_name (int4, varchar, timestamp, jsonb, ...), which also works as a cast.
  type: string;
  columnDefault: string | null;
}

export interface Catalog {
  tables: readonly string[];
  columns: readonly CatalogColumn[];
}

export interface TableShape {
  spec: CopyTableSpec;
  columns: readonly { name: string; type: string }[];
  // Sequences behind the target's column defaults, moved past the copied values afterwards.
  sequences: readonly { column: string; sequence: string }[];
}

const NEXTVAL_DEFAULT = /^nextval\('((?:[^']|'')+)'::regclass\)$/;

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function columnsOf(catalog: Catalog, table: string): CatalogColumn[] {
  return catalog.columns.filter((column) => column.table === table);
}

function shapeProblems(spec: CopyTableSpec, source: Catalog, target: Catalog): string[] {
  if (!target.tables.includes(spec.name)) return [`the target has no table ${spec.name}: apply the schema first`];
  if (!source.tables.includes(spec.name)) return [`the source has no table ${spec.name}`];
  const sourceColumns = columnsOf(source, spec.name).map((column) => column.column);
  const targetColumns = columnsOf(target, spec.name).map((column) => column.column);
  return [
    ...targetColumns.filter((column) => !sourceColumns.includes(column)).map((column) => `the source has no column ${spec.name}.${column}`),
    ...sourceColumns
      .filter((column) => !targetColumns.includes(column))
      .map((column) => `the target has no column ${spec.name}.${column}, so the copy would drop it`),
    ...spec.keyColumns
      .filter((column) => !targetColumns.includes(column))
      .map((column) => `key column ${spec.name}.${column} is not in the target`),
  ];
}

function sequencesOf(columns: readonly CatalogColumn[]): TableShape['sequences'] {
  return columns.flatMap((column) => {
    const match = NEXTVAL_DEFAULT.exec(column.columnDefault ?? '');
    return match ? [{ column: column.column, sequence: match[1].replace(/''/g, "'") }] : [];
  });
}

/**
 * The shape of each table to copy, read from the target's catalog, after checking that both
 * databases hold the same tables and columns. Throws with every mismatch it finds.
 */
export function planTableShapes(specs: readonly CopyTableSpec[], source: Catalog, target: Catalog): TableShape[] {
  const specNames = specs.map((spec) => spec.name);
  const problems = [
    ...target.tables
      .filter((table) => !specNames.includes(table))
      .map((table) => `the target has table ${table}, which COPY_TABLES in scripts/db/copyTables.ts does not list`),
    ...specs.flatMap((spec) => shapeProblems(spec, source, target)),
  ];
  if (problems.length > 0) throw new Error(`The databases do not match:\n  ${problems.join('\n  ')}`);
  return specs.map((spec) => {
    const columns = columnsOf(target, spec.name);
    return { spec, columns: columns.map(({ column, type }) => ({ name: column, type })), sequences: sequencesOf(columns) };
  });
}

export function selectRowsSql(shape: TableShape): string {
  const columns = shape.columns.map(({ name }) => `${quoteIdentifier(name)}::text AS ${quoteIdentifier(name)}`).join(', ');
  const order = shape.spec.keyColumns.map(quoteIdentifier).join(', ');
  return `SELECT ${columns} FROM ${quoteIdentifier(shape.spec.name)} ORDER BY ${order}`;
}

// Each value arrives as text and is cast to the column's type in the target, so the driver never
// converts it: a timestamp read as a JS Date would shift by the machine's time zone, and a jsonb
// value sent as an object would be stored as a JSON string.
export function upsertRowSql(shape: TableShape): string {
  const names = shape.columns.map(({ name }) => quoteIdentifier(name)).join(', ');
  const values = shape.columns.map(({ type }, columnI) => `$${columnI + 1}::text::${type}`).join(', ');
  const keys = shape.spec.keyColumns.map(quoteIdentifier).join(', ');
  const updates = shape.columns
    .filter(({ name }) => !shape.spec.keyColumns.includes(name))
    .map(({ name }) => `${quoteIdentifier(name)} = EXCLUDED.${quoteIdentifier(name)}`);
  const onConflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';
  return `INSERT INTO ${quoteIdentifier(shape.spec.name)} (${names}) VALUES (${values}) ON CONFLICT (${keys}) ${onConflict}`;
}

export function upsertRowValues(shape: TableShape, row: TextRow): (string | null)[] {
  return shape.columns.map(({ name }) => row[name] ?? null);
}

export function deleteRowSql(shape: TableShape): string {
  const conditions = shape.spec.keyColumns.map((name, keyI) => {
    const type = shape.columns.find((column) => column.name === name)?.type ?? 'text';
    return `${quoteIdentifier(name)} = $${keyI + 1}::text::${type}`;
  });
  return `DELETE FROM ${quoteIdentifier(shape.spec.name)} WHERE ${conditions.join(' AND ')}`;
}

/** The key of a row as JSON, the form the comparison and the delete statement take it in. */
export function rowKey(shape: TableShape, row: TextRow): string {
  return JSON.stringify(shape.spec.keyColumns.map((name) => row[name] ?? null));
}

function rowHash(shape: TableShape, row: TextRow): string {
  return createHash('sha256')
    .update(JSON.stringify(shape.columns.map(({ name }) => row[name] ?? null)))
    .digest('hex');
}

export function rowTextBytes(row: TextRow): number {
  return Object.values(row).reduce((sum, value) => sum + (value === null ? 0 : Buffer.byteLength(value, 'utf8')), 0);
}

// The sequence moves to one past the largest value, so the next nextval() hands out a free id.
export function setSequenceSql(shape: TableShape, sequence: TableShape['sequences'][number]): string {
  const column = quoteIdentifier(sequence.column);
  return `SELECT setval(${quoteLiteral(sequence.sequence)}, (SELECT coalesce(max(${column}), 0) + 1 FROM ${quoteIdentifier(shape.spec.name)}), false)`;
}

export interface TableComparison {
  table: string;
  expected: number;
  actual: number;
  identical: number;
  missing: string[];
  extra: string[];
  different: string[];
}

/** Compares every row the target must hold with every row it holds, by key and by a hash of all columns. */
export function compareRows(shape: TableShape, expected: readonly TextRow[], actual: readonly TextRow[]): TableComparison {
  const actualHashes = new Map(actual.map((row) => [rowKey(shape, row), rowHash(shape, row)]));
  const expectedKeys = new Set(expected.map((row) => rowKey(shape, row)));
  const present = expected.filter((row) => actualHashes.has(rowKey(shape, row)));
  const different = present.filter((row) => actualHashes.get(rowKey(shape, row)) !== rowHash(shape, row));
  return {
    table: shape.spec.name,
    expected: expected.length,
    actual: actual.length,
    identical: present.length - different.length,
    missing: expected.filter((row) => !actualHashes.has(rowKey(shape, row))).map((row) => rowKey(shape, row)),
    extra: [...actualHashes.keys()].filter((key) => !expectedKeys.has(key)),
    different: different.map((row) => rowKey(shape, row)),
  };
}

export function isIdentical(comparison: TableComparison): boolean {
  return comparison.missing.length === 0 && comparison.extra.length === 0 && comparison.different.length === 0;
}
