#!/usr/bin/env npx tsx
/**
 * Copies every app table from a PostgreSQL database (Neon, at the move) into an Aurora DSQL
 * cluster, then reads every row of both again and compares them, then moves the cluster's id
 * sequences past the copied ids. Apply the schema first (scripts/db/apply-schema-dsql.ts).
 *
 * pg_dump output does not load into DSQL, so the copy goes row by row:
 * - The source is only read, in REPEATABLE READ READ ONLY transactions, so it sees one snapshot.
 * - Every value travels as text and is cast to the column's type in the target.
 * - Rows are upserted on their key, so the copy can run again at the cut-over and write only the
 *   rows that changed. Each transaction stays under DSQL's 3,000-row and 10 MiB limits and is
 *   run again on a write conflict (40001).
 * - A book too large for one DSQL value stops the copy before anything is written.
 * - A book's content_bytes is copied only while it matches its text; otherwise as NULL.
 * - Rows the target holds and the source does not are reported, and deleted with --delete-extra.
 * - A table in IMPORTED_TABLES (the ruby registry) is not copied: its own import script fills it.
 *
 * It signs an admin IAM token with the default AWS credentials, and refuses any target but a DSQL
 * endpoint. Exits 1 unless every row is identical.
 *
 * Usage:
 *   SOURCE_URL='<postgres url>' npx tsx scripts/db/copy-to-dsql.ts --endpoint <cluster id>.dsql.<region>.on.aws [--delete-extra]
 */

import postgres from 'postgres';
import {
  buildDsqlOptions,
  DSQL_ADMIN_USER,
  iamTokenSource,
  regionOfDsqlEndpoint,
  type DsqlSettings,
} from '../../lib/db/connectionConfig';
import { runWriteTransaction } from '../../lib/db/writeTransaction';
import { groupBySize } from '../../lib/utils/groupBySize';
import {
  compareRows,
  COPY_TABLES,
  deleteRowSql,
  IMPORTED_TABLES,
  isIdentical,
  planTableShapes,
  rowKey,
  rowTextBytes,
  selectRowsSql,
  setSequenceSql,
  upsertRowSql,
  upsertRowValues,
  type Catalog,
  type CatalogColumn,
  type TableComparison,
  type TableShape,
  type TextRow,
} from './copyTables';
import { isEntryPoint } from '../shared/entryPoint';

const USAGE =
  "usage: SOURCE_URL='<postgres url>' npx tsx scripts/db/copy-to-dsql.ts --endpoint <cluster id>.dsql.<region>.on.aws [--delete-extra]";

// DSQL allows 3,000 rows and 10 MiB per transaction. A row's text is at least what DSQL stores for
// it, so 4 MiB of text per transaction keeps well under the size limit.
const MAX_TRANSACTION_ROWS = 1000;
const MAX_TRANSACTION_TEXT_BYTES = 4 * 1024 * 1024;
const SOURCE_SNAPSHOT = 'isolation level repeatable read read only';

export interface CopyArgs {
  target: DsqlSettings;
  shouldDeleteExtra: boolean;
}

export interface CopyOptions {
  shouldDeleteExtra: boolean;
  log: (line: string) => void;
}

export interface TableCopyResult {
  table: string;
  written: number;
  deleted: number;
  verification: TableComparison;
}

export interface CopyReport {
  tables: TableCopyResult[];
  sequences: string[];
}

export function parseCopyArgs(args: readonly string[]): CopyArgs {
  const [flag, endpoint = '', ...rest] = args;
  const region = regionOfDsqlEndpoint(endpoint);
  const unknownFlags = rest.filter((arg) => arg !== '--delete-extra');
  if (flag !== '--endpoint' || !region || unknownFlags.length > 0) throw new Error(USAGE);
  return { target: { endpoint, region, user: DSQL_ADMIN_USER }, shouldDeleteExtra: rest.includes('--delete-extra') };
}

// Neon's pooled endpoint runs PgBouncer in transaction mode; the copy reads through the direct one.
export function assertDirectSource(sourceUrl: string): void {
  if (!new URL(sourceUrl).hostname.includes('-pooler.')) return;
  throw new Error('SOURCE_URL names a Neon pooled endpoint: remove -pooler from the host name to use the direct endpoint');
}

async function readCatalog(client: postgres.Sql): Promise<Catalog> {
  const tables = await client<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const columns = await client<{ table_name: string; column_name: string; udt_name: string; column_default: string | null }[]>`
    SELECT table_name, column_name, udt_name, column_default FROM information_schema.columns
    WHERE table_schema = current_schema()
    ORDER BY table_name, ordinal_position
  `;
  return {
    tables: tables.map((row) => row.table_name),
    columns: columns.map(
      (row): CatalogColumn => ({ table: row.table_name, column: row.column_name, type: row.udt_name, columnDefault: row.column_default })
    ),
  };
}

// The rows the target must hold, all read in one snapshot of the source.
async function readExpectedRows(source: postgres.Sql, shapes: readonly TableShape[]): Promise<TextRow[][]> {
  const sourceRows = await source.begin(SOURCE_SNAPSHOT, (tx) =>
    Promise.all(shapes.map((shape) => tx.unsafe<TextRow[]>(selectRowsSql(shape))))
  );
  return shapes.map((shape, tableI) => {
    const { prepareRow } = shape.spec;
    return prepareRow ? sourceRows[tableI].map(prepareRow) : [...sourceRows[tableI]];
  });
}

async function readTargetRows(target: postgres.Sql, shape: TableShape): Promise<TextRow[]> {
  return [...(await target.unsafe<TextRow[]>(selectRowsSql(shape)))];
}

function assertRowsFit(shapes: readonly TableShape[], expectedRows: readonly TextRow[][]): void {
  const refusals = shapes.flatMap((shape, tableI) => {
    const { refusalOf } = shape.spec;
    if (!refusalOf) return [];
    return expectedRows[tableI].flatMap((row) => {
      const refusal = refusalOf(row);
      return refusal === null ? [] : [`${shape.spec.name} ${rowKey(shape, row)}: ${refusal}`];
    });
  });
  if (refusals.length === 0) return;
  throw new Error(`Nothing was copied: the target cannot store ${refusals.length} row(s):\n  ${refusals.join('\n  ')}`);
}

export function transactionGroups<T>(items: readonly T[], bytesOf: (item: T) => number): T[][] {
  return groupBySize(items, bytesOf, MAX_TRANSACTION_TEXT_BYTES).flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / MAX_TRANSACTION_ROWS) }, (_, groupI) =>
      group.slice(groupI * MAX_TRANSACTION_ROWS, (groupI + 1) * MAX_TRANSACTION_ROWS)
    )
  );
}

interface GroupedWrites<T> {
  items: readonly T[];
  bytesOf: (item: T) => number;
  write: (tx: postgres.TransactionSql, item: T) => Promise<unknown>;
}

// Inside a transaction the COMMIT reports what DSQL raises at commit, which a postgres.js
// autocommit statement would drop; a write conflict runs the whole group again.
async function writeInTransactions<T>(target: postgres.Sql, shape: TableShape, writes: GroupedWrites<T>): Promise<void> {
  for (const group of transactionGroups(writes.items, writes.bytesOf)) {
    try {
      await runWriteTransaction(target, async (tx) => {
        for (const item of group) await writes.write(tx, item);
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${shape.spec.name}: a transaction of ${group.length} row(s) failed: ${reason}`, { cause: error });
    }
  }
}

async function deleteExtraRows(target: postgres.Sql, shape: TableShape, keys: string[]): Promise<void> {
  const statement = deleteRowSql(shape);
  await writeInTransactions(target, shape, {
    items: keys,
    bytesOf: (key) => key.length,
    write: (tx, key) => tx.unsafe(statement, JSON.parse(key) as (string | null)[]),
  });
}

async function upsertRows(target: postgres.Sql, shape: TableShape, rows: TextRow[]): Promise<void> {
  const statement = upsertRowSql(shape);
  await writeInTransactions(target, shape, {
    items: rows,
    bytesOf: rowTextBytes,
    write: (tx, row) => tx.unsafe(statement, upsertRowValues(shape, row)),
  });
}

interface TablePlan {
  shape: TableShape;
  expected: TextRow[];
}

// Writes only the rows that are missing or different in the target, so a second run at the
// cut-over sends little more than what changed since the first.
async function copyTable(target: postgres.Sql, { shape, expected }: TablePlan, options: CopyOptions): Promise<{ written: number; deleted: number }> {
  const before = compareRows(shape, expected, await readTargetRows(target, shape));
  const keysToWrite = new Set([...before.missing, ...before.different]);
  const rowsToWrite = expected.filter((row) => keysToWrite.has(rowKey(shape, row)));
  const extraKeys = options.shouldDeleteExtra ? before.extra : [];
  if (extraKeys.length > 0) await deleteExtraRows(target, shape, extraKeys);
  await upsertRows(target, shape, rowsToWrite);

  const keptExtraCount = before.extra.length - extraKeys.length;
  const keptNote = keptExtraCount > 0 ? `, ${keptExtraCount} extra kept (--delete-extra deletes them)` : '';
  options.log(`${shape.spec.name}: ${expected.length} in the source, ${rowsToWrite.length} written, ${extraKeys.length} deleted${keptNote}`);
  return { written: rowsToWrite.length, deleted: extraKeys.length };
}

async function verifyTables(source: postgres.Sql, target: postgres.Sql, shapes: readonly TableShape[]): Promise<TableComparison[]> {
  const expectedRows = await readExpectedRows(source, shapes);
  return Promise.all(shapes.map(async (shape, tableI) => compareRows(shape, expectedRows[tableI], await readTargetRows(target, shape))));
}

// Each setval is sent without parameters, so postgres.js uses the simple protocol and reports an
// error DSQL raises at commit.
async function moveSequences(target: postgres.Sql, shapes: readonly TableShape[]): Promise<string[]> {
  const sequences = shapes.flatMap((shape) => shape.sequences.map((sequence) => ({ shape, sequence })));
  const moved: string[] = [];
  for (const { shape, sequence } of sequences) {
    const [{ setval }] = await target.unsafe<{ setval: string }[]>(setSequenceSql(shape, sequence));
    moved.push(`${sequence.sequence} next ${setval}`);
  }
  return moved;
}

/**
 * Copies every table in COPY_TABLES from source into target, verifies every row, and moves the
 * target's sequences. Throws before writing anything when the catalogs differ or a row is too large.
 */
export async function copyDatabase(source: postgres.Sql, target: postgres.Sql, options: CopyOptions): Promise<CopyReport> {
  const [sourceCatalog, targetCatalog] = await Promise.all([readCatalog(source), readCatalog(target)]);
  const shapes = planTableShapes(COPY_TABLES, sourceCatalog, targetCatalog);
  IMPORTED_TABLES.filter((table) => targetCatalog.tables.includes(table.name)).forEach(({ name, importedBy }) =>
    options.log(`${name}: not copied; fill it with ${importedBy}`)
  );
  const expectedRows = await readExpectedRows(source, shapes);
  assertRowsFit(shapes, expectedRows);

  const copied: { written: number; deleted: number }[] = [];
  for (const [tableI, shape] of shapes.entries()) {
    copied.push(await copyTable(target, { shape, expected: expectedRows[tableI] }, options));
  }

  options.log('Verifying: reading every row of both databases again');
  const verification = await verifyTables(source, target, shapes);
  const sequences = await moveSequences(target, shapes);
  return {
    tables: shapes.map((shape, tableI) => ({ table: shape.spec.name, ...copied[tableI], verification: verification[tableI] })),
    sequences,
  };
}

const MAX_KEYS_SHOWN = 20;

function describeKeys(label: string, keys: readonly string[]): string[] {
  if (keys.length === 0) return [];
  const shown = keys.slice(0, MAX_KEYS_SHOWN).join(' ');
  const more = keys.length > MAX_KEYS_SHOWN ? ` and ${keys.length - MAX_KEYS_SHOWN} more` : '';
  return [`    ${label}: ${shown}${more}`];
}

export function describeReport(report: CopyReport): string[] {
  const tableLines = report.tables.flatMap(({ verification }) => [
    `  ${verification.table}: ${verification.identical} of ${verification.expected} identical; ` +
      `missing ${verification.missing.length}, extra ${verification.extra.length}, different ${verification.different.length}`,
    ...describeKeys('missing', verification.missing),
    ...describeKeys('extra', verification.extra),
    ...describeKeys('different', verification.different),
  ]);
  const isEveryRowIdentical = report.tables.every(({ verification }) => isIdentical(verification));
  return [
    'Verification:',
    ...tableLines,
    `Sequences: ${report.sequences.join(', ') || 'none'}`,
    isEveryRowIdentical ? 'Every row is identical.' : 'Some rows differ. Fix the cause and run the copy again.',
  ];
}

export async function main(args: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  const { target: targetSettings, shouldDeleteExtra } = parseCopyArgs(args);
  const sourceUrl = env.SOURCE_URL;
  if (!sourceUrl) throw new Error(`SOURCE_URL is not set\n${USAGE}`);
  assertDirectSource(sourceUrl);

  const source = postgres(sourceUrl, { max: 1, onnotice: () => undefined });
  const target = postgres({ ...buildDsqlOptions(targetSettings, iamTokenSource(targetSettings)), max: 1, onnotice: () => undefined });
  try {
    console.log(`Source: ${source.options.host.join(', ')} (read only)`);
    console.log(`Target: ${targetSettings.endpoint}`);
    const report = await copyDatabase(source, target, { shouldDeleteExtra, log: (line) => console.log(line) });
    describeReport(report).forEach((line) => console.log(line));
    return report.tables.every(({ verification }) => isIdentical(verification));
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2), process.env)
    .then((isEveryRowIdentical) => {
      if (!isEveryRowIdentical) process.exit(1);
    })
    .catch((error) => {
      console.error('copy-to-dsql failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
