import type { Client } from 'pg';
import { BookTextTooLargeError, estimateStoredBytes, MAX_STORED_TEXT_BYTES } from './bookTextSize';
import { withCurrentContentBytes } from './contentBytes';
import { createPgClient } from './pgClient';
import { prodClientConfig, type ProdDatabase } from './prodDatabase';
import { retryOnSerializationFailure } from './writeTransaction';
import { groupBySize } from '../utils/groupBySize';

export type SyncDirection = 'prod -> local' | 'local -> prod';

type IdentityKey =
  | { kind: 'column'; col: string }
  | { kind: 'composite'; cols: readonly [string, string]; sep: string };

type ConflictKey =
  | { kind: 'column'; col: string }
  | { kind: 'composite'; cols: readonly [string, string, ...string[]] };

const FILE_DIR_PAIR = ['file_name', 'directory'] as const;

// Every table in this schema names its surrogate primary key `id`. If that
// assumption ever changes, lift this into a per-table TableConfig field.
const SURROGATE_PK = 'id';

export interface TableConfig {
  name: string;
  conflictKey: ConflictKey;
  orderBy: string;
  identity: IdentityKey;
  // Every synced table is last-write-wins on this column.
  timestampCol: string;
  // Applied to each source row before it is written to the target.
  prepareRow?: (row: Record<string, unknown>) => Record<string, unknown>;
  // Why production must not store this row, or null when it may. Checked only when pushing.
  prodRefusalOf?: (row: Record<string, unknown>) => string | null;
}

// A book too large for one Aurora DSQL value stays off production, Neon included, so that every
// book there can move to DSQL. The local database stores any size.
function bookTooLargeForProd(row: Record<string, unknown>): string | null {
  const estimatedStoredBytes = estimateStoredBytes(String(row.content));
  if (estimatedStoredBytes <= MAX_STORED_TEXT_BYTES) return null;
  return new BookTextTooLargeError(estimatedStoredBytes).message;
}

export const TABLES: TableConfig[] = [
  {
    name: 'bookmarks',
    conflictKey: { kind: 'composite', cols: FILE_DIR_PAIR },
    orderBy: 'updated_at',
    identity: { kind: 'composite', cols: FILE_DIR_PAIR, sep: '|' },
    timestampCol: 'updated_at',
  },
  {
    name: 'vocabulary_entries',
    conflictKey: { kind: 'column', col: 'id' },
    orderBy: 'created_at',
    identity: { kind: 'column', col: 'word' },
    timestampCol: 'updated_at',
  },
  {
    name: 'text_entries',
    conflictKey: { kind: 'composite', cols: FILE_DIR_PAIR },
    orderBy: 'created_at',
    identity: { kind: 'composite', cols: FILE_DIR_PAIR, sep: '|' },
    timestampCol: 'updated_at',
    prepareRow: withCurrentContentBytes,
    prodRefusalOf: bookTooLargeForProd,
  },
];

export function stripQuotes(name: string): string {
  return name.replace(/^"|"$/g, '');
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function getColumns(client: Client, tableName: string): Promise<string[]> {
  const bare = stripQuotes(tableName);
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = current_schema()
     ORDER BY ordinal_position`,
    [bare]
  );
  return result.rows.map((r: { column_name: string }) => r.column_name);
}

// A target that numbers its rows from a sequence (SERIAL, or Aurora DSQL's nextval default) has
// to number a copied row itself. Sending the source's id would collide with a row the target
// numbered (23505), and leave its sequence behind ids already taken, so the app's next insert
// there would collide too. Rows are matched on their conflict key, never on id.
async function targetNumbersIds(client: Client, tableName: string): Promise<boolean> {
  const result = await client.query(
    `SELECT column_default FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2 AND table_schema = current_schema()`,
    [stripQuotes(tableName), SURROGATE_PK]
  );
  const columnDefault: unknown = result.rows[0]?.column_default;
  return typeof columnDefault === 'string' && columnDefault.startsWith('nextval(');
}

async function getCount(client: Client, table: string): Promise<number | null> {
  const bare = stripQuotes(table);
  try {
    const result = await client.query(`SELECT COUNT(*) as count FROM "${bare}"`);
    return parseInt(result.rows[0].count, 10);
  } catch (err) {
    console.error(`[sync-core] getCount(${bare}) failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Millisecond precision matches what the pg driver round-trips: a local
// timestamp(6) value with sub-ms digits can never be beaten by an upsert from
// the driver, so comparing at microseconds would flag it as newer forever.
function syncTimestampMsExpr(table: TableConfig): string {
  return `floor(extract(epoch from ${table.timestampCol}) * 1000)`;
}

function identityQuery(table: TableConfig): string {
  const bare = stripQuotes(table.name);
  const keyExpr = table.identity.kind === 'composite'
    ? `${table.identity.cols[0]} || '${table.identity.sep}' || ${table.identity.cols[1]}`
    : `${table.identity.col}::text`;
  return `SELECT ${keyExpr} as key, ${syncTimestampMsExpr(table)} as updated_at FROM "${bare}"`;
}

async function getIdentitySnapshots(
  client: Client,
  table: TableConfig
): Promise<Map<string, number | null>> {
  try {
    const result = await client.query(identityQuery(table));
    return new Map(
      result.rows.map((r: { key: string; updated_at: string | null }): [string, number | null] => [
        r.key,
        r.updated_at === null ? null : Number(r.updated_at),
      ])
    );
  } catch (err) {
    console.error(
      `[sync-core] getIdentitySnapshots(${stripQuotes(table.name)}) failed:`,
      err instanceof Error ? err.message : err
    );
    return new Map();
  }
}

export interface DiffResult {
  table: string;
  localCount: number | null;
  prodCount: number | null;
  onlyLocal: string[];
  onlyProd: string[];
  localNewer: number;
  prodNewer: number;
}

// Rows present on both sides whose last-write-wins timestamp differs. Identity
// diffs alone miss these, so an edited-in-place row (e.g. a moved bookmark)
// would otherwise look "in sync" and never get pushed.
function countNewer(
  localRows: Map<string, number | null>,
  prodRows: Map<string, number | null>
): { localNewer: number; prodNewer: number } {
  let localNewer = 0;
  let prodNewer = 0;
  for (const [key, localTs] of localRows) {
    const prodTs = prodRows.get(key);
    if (prodTs === undefined || localTs === null || prodTs === null) continue;
    if (localTs > prodTs) localNewer++;
    else if (prodTs > localTs) prodNewer++;
  }
  return { localNewer, prodNewer };
}

export async function computeDiffs(prod: Client, local: Client): Promise<DiffResult[]> {
  const diffs: DiffResult[] = [];
  for (const table of TABLES) {
    const [localCount, prodCount, localRows, prodRows] = await Promise.all([
      getCount(local, table.name),
      getCount(prod, table.name),
      getIdentitySnapshots(local, table),
      getIdentitySnapshots(prod, table),
    ]);
    const { localNewer, prodNewer } = countNewer(localRows, prodRows);
    diffs.push({
      table: stripQuotes(table.name),
      localCount,
      prodCount,
      onlyLocal: Array.from(localRows.keys()).filter(id => !prodRows.has(id)),
      onlyProd: Array.from(prodRows.keys()).filter(id => !localRows.has(id)),
      localNewer,
      prodNewer,
    });
  }
  return diffs;
}

function conflictColumns(key: ConflictKey): readonly string[] {
  return key.kind === 'column' ? [key.col] : key.cols;
}

function buildBatchUpsertSql(table: TableConfig, columns: string[], batchSize: number): string {
  const colList = columns.map(quoteIdent).join(', ');

  const rowPlaceholders: string[] = [];
  for (let batchI = 0; batchI < batchSize; batchI++) {
    const cols = columns.map((_, colI) => `$${batchI * columns.length + colI + 1}`).join(', ');
    rowPlaceholders.push(`(${cols})`);
  }
  const valuesClause = rowPlaceholders.join(', ');

  const conflictCols = conflictColumns(table.conflictKey);
  const conflictExpr = conflictCols.map(quoteIdent).join(', ');

  const ts = table.timestampCol;
  // Keep the target's surrogate PK on conflict: serial ids are assigned
  // separately in each database. The conflict columns are likewise excluded
  // since updating them would change the row's identity.
  const excludedFromUpdate = new Set<string>([...conflictCols, SURROGATE_PK]);
  const updateSet = columns
    .filter(c => !excludedFromUpdate.has(c))
    .map(c => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
    .join(', ');

  return `INSERT INTO ${table.name} (${colList}) VALUES ${valuesClause}
          ON CONFLICT (${conflictExpr}) DO UPDATE SET ${updateSet}
          WHERE EXCLUDED.${ts} > ${table.name}.${ts}`;
}

export interface SyncResult {
  table: string;
  rows: number;
  skipped: number;
  failed: number;
  direction: SyncDirection;
}

const BATCH_SIZE = 25;
const PG_MAX_PARAMS = 65535;
// Aurora DSQL refuses a message over 10 MiB (08P01, dropping the connection) and a transaction
// that writes over 10 MiB (54000). A statement holds rows up to this many parameter bytes, so
// it stays far below both; a row larger than this, such as most books, is sent on its own.
const MAX_BATCH_BYTES = 1024 * 1024;
// Numbers, dates and booleans travel as a few bytes of text.
const SCALAR_PARAMETER_BYTES = 8;

// Aurora DSQL answers a message over 10 MiB with 08P01 and then drops the connection.
const PROTOCOL_VIOLATION = '08P01';

function errorCodeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

function isConnectionLost(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (errorCodeOf(err) === PROTOCOL_VIOLATION) return true;
  const msg = err.message;
  return msg.includes('Client was closed')
    || msg.includes('Connection terminated')
    || msg.includes('Client has encountered a connection error');
}

function describeDatabaseError(err: unknown): string {
  const code = errorCodeOf(err);
  const message = err instanceof Error ? err.message : String(err);
  return code ? `[${code}] ${message}` : message;
}

function connectionLostError(tableName: string, err: unknown): Error {
  return new Error(`[sync-core] ${tableName}: target connection closed mid-sync: ${describeDatabaseError(err)}`, { cause: err });
}

function parameterBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  }
  return SCALAR_PARAMETER_BYTES;
}

function rowParameterBytes(row: Record<string, unknown>, columns: readonly string[]): number {
  return columns.reduce((sum, column) => sum + parameterBytes(row[column]), 0);
}

function planBatches(rows: Record<string, unknown>[], columns: readonly string[]): Record<string, unknown>[][] {
  return groupBySize(rows, (row) => rowParameterBytes(row, columns), MAX_BATCH_BYTES).flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / BATCH_SIZE) }, (_, batchI) =>
      group.slice(batchI * BATCH_SIZE, (batchI + 1) * BATCH_SIZE)
    )
  );
}

type KeySnapshot = Map<string, { keyValues: unknown[]; updatedAtMs: number | null }>;

function keySnapshotQuery(table: TableConfig): string {
  const keyCols = conflictColumns(table.conflictKey).map(quoteIdent).join(', ');
  return `SELECT ${keyCols}, ${syncTimestampMsExpr(table)} as sync_ts FROM ${table.name}`;
}

async function getKeySnapshot(client: Client, table: TableConfig): Promise<KeySnapshot> {
  const keyCols = conflictColumns(table.conflictKey);
  const result = await client.query(keySnapshotQuery(table));
  return new Map(
    result.rows.map((row: Record<string, unknown>) => {
      const keyValues = keyCols.map(c => row[c]);
      const updatedAtMs = row.sync_ts === null ? null : Number(row.sync_ts);
      return [JSON.stringify(keyValues), { keyValues, updatedAtMs }];
    })
  );
}

// Ship only rows the target lacks or holds an older copy of. Sending every row
// and letting the upsert's WHERE discard it moved ~17 MB of text_entries each
// way on every sync, which alone took close to the dev wrapper's timeout.
function selectKeysToTransfer(source: KeySnapshot, target: KeySnapshot): unknown[][] {
  const keys: unknown[][] = [];
  for (const [key, sourceEntry] of source) {
    const targetEntry = target.get(key);
    if (targetEntry === undefined) {
      keys.push(sourceEntry.keyValues);
      continue;
    }
    if (sourceEntry.updatedAtMs === null || targetEntry.updatedAtMs === null) continue;
    if (sourceEntry.updatedAtMs > targetEntry.updatedAtMs) keys.push(sourceEntry.keyValues);
  }
  return keys;
}

const FETCH_KEYS_CHUNK = 500;

async function fetchRowsByKey(
  client: Client,
  table: TableConfig,
  keys: unknown[][]
): Promise<Record<string, unknown>[]> {
  const keyCols = conflictColumns(table.conflictKey);
  const keyList = keyCols.map(quoteIdent).join(', ');
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start < keys.length; start += FETCH_KEYS_CHUNK) {
    const chunk = keys.slice(start, start + FETCH_KEYS_CHUNK);
    const tuples = chunk
      .map((_, rowI) => `(${keyCols.map((_, colI) => `$${rowI * keyCols.length + colI + 1}`).join(', ')})`)
      .join(', ');
    const result = await client.query(
      `SELECT * FROM ${table.name} WHERE (${keyList}) IN (${tuples}) ORDER BY ${table.orderBy}`,
      chunk.flat()
    );
    rows.push(...result.rows);
  }
  return rows;
}

// Snapshot and fetch failures abort the whole sync; name the table and
// direction so the one-line report says where it stopped.
async function withSyncContext<T>(context: string, step: Promise<T>): Promise<T> {
  try {
    return await step;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`[sync-core] ${context}: ${reason}`, { cause: err });
  }
}

function rowIdentityLog(table: TableConfig, row: Record<string, unknown>): string {
  const cols = conflictColumns(table.conflictKey);
  return cols.map(c => `${c}=${row[c]}`).join(',');
}

function selectRowsProdAccepts(table: TableConfig, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const { prodRefusalOf } = table;
  if (!prodRefusalOf) return rows;
  return rows.filter((row) => {
    const refusal = prodRefusalOf(row);
    if (refusal === null) return true;
    console.error(`  [ERR] ${table.name} row (${rowIdentityLog(table, row)}) not pushed: ${refusal}`);
    return false;
  });
}

export async function syncDirection(
  source: Client,
  target: Client,
  table: TableConfig,
  direction: SyncDirection
): Promise<SyncResult> {
  const tableName = stripQuotes(table.name);
  const sourceColumns = await getColumns(source, table.name);
  if (sourceColumns.length === 0) return { table: tableName, rows: 0, skipped: 0, failed: 0, direction };
  const isIdConflictKey = conflictColumns(table.conflictKey).includes(SURROGATE_PK);
  const isIdFromTarget = !isIdConflictKey && (await targetNumbersIds(target, table.name));
  const columns = isIdFromTarget ? sourceColumns.filter((column) => column !== SURROGATE_PK) : sourceColumns;

  // Crash early on impossible state: if a future schema widens to where one
  // batch would exceed PG's hard parameter limit, the cause would otherwise
  // surface only on the last (partial) batch of large tables.
  if (columns.length * BATCH_SIZE > PG_MAX_PARAMS) {
    throw new Error(
      `[sync-core] ${tableName}: ${columns.length} cols x BATCH_SIZE ${BATCH_SIZE} ` +
      `exceeds PG param limit ${PG_MAX_PARAMS}; lower BATCH_SIZE or split the schema`
    );
  }

  const context = `${tableName} ${direction}`;
  const [sourceSnapshot, targetSnapshot] = await withSyncContext(
    `${context} snapshot`,
    Promise.all([getKeySnapshot(source, table), getKeySnapshot(target, table)])
  );
  const keys = selectKeysToTransfer(sourceSnapshot, targetSnapshot);
  if (keys.length === 0) return { table: tableName, rows: 0, skipped: 0, failed: 0, direction };

  const fetchedRows = await withSyncContext(`${context} fetch`, fetchRowsByKey(source, table, keys));
  const sourceRows = table.prepareRow ? fetchedRows.map(table.prepareRow) : fetchedRows;
  const unfetchedCount = keys.length - sourceRows.length;
  if (unfetchedCount > 0) {
    console.error(
      `  [ERR] ${table.name}: ${unfetchedCount} selected row(s) not returned by the source ` +
      `(NULL in a conflict key column, or deleted mid-sync)`
    );
  }

  const rowsToWrite = direction === 'local -> prod' ? selectRowsProdAccepts(table, sourceRows) : sourceRows;
  const singleRowSql = buildBatchUpsertSql(table, columns, 1);
  let rows = 0;
  let skipped = 0;
  let failed = unfetchedCount + sourceRows.length - rowsToWrite.length;
  for (const batch of planBatches(rowsToWrite, columns)) {
    const sql = buildBatchUpsertSql(table, columns, batch.length);
    const values: unknown[] = [];
    for (const row of batch) {
      for (const c of columns) values.push(row[c]);
    }

    try {
      // pg waits for the commit of an autocommit statement, so a conflict Aurora DSQL raises at
      // commit (40001) arrives here with nothing written, and the statement can be sent again.
      const result = await retryOnSerializationFailure(() => target.query(sql, values));
      const affected = result.rowCount ?? 0;
      rows += affected;
      skipped += batch.length - affected;
    } catch (err) {
      // A dead connection will fail every remaining batch identically — bail
      // out so the wrapper's outer catch can report one error instead of N.
      if (isConnectionLost(err)) throw connectionLostError(tableName, err);
      // Data error: one poison row aborted the whole batch atomically. Retry
      // row-by-row to land the valid rows and pinpoint the offender.
      console.error(
        `  [WARN] ${table.name} (batch of ${batch.length}) failed, retrying per-row: ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
      for (const row of batch) {
        const singleValues = columns.map(c => row[c]);
        try {
          const result = await retryOnSerializationFailure(() => target.query(singleRowSql, singleValues));
          const affected = result.rowCount ?? 0;
          rows += affected;
          skipped += 1 - affected;
        } catch (rowErr) {
          if (isConnectionLost(rowErr)) throw connectionLostError(tableName, rowErr);
          failed++;
          console.error(
            `  [ERR] ${table.name} row (${rowIdentityLog(table, row)}): ` +
            `${rowErr instanceof Error ? rowErr.message : String(rowErr)}`
          );
        }
      }
    }
  }

  return { table: tableName, rows, skipped, failed, direction };
}

export async function withClients<T>(
  prodDatabase: ProdDatabase,
  localUrl: string,
  fn: (prod: Client, local: Client) => Promise<T>
): Promise<T> {
  const prod = createPgClient(prodClientConfig(prodDatabase), 'prod');
  const local = createPgClient({ connectionString: localUrl }, 'local');

  try {
    await Promise.all([prod.connect(), local.connect()]);
    return await fn(prod, local);
  } finally {
    await prod.end().catch(() => {});
    await local.end().catch(() => {});
  }
}

export async function pull(prod: Client, local: Client): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const table of TABLES) {
    results.push(await syncDirection(prod, local, table, 'prod -> local'));
  }
  return results;
}

export async function push(prod: Client, local: Client): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const table of TABLES) {
    results.push(await syncDirection(local, prod, table, 'local -> prod'));
  }
  return results;
}

export async function fullSync(prod: Client, local: Client): Promise<SyncResult[]> {
  const pullResults = await pull(prod, local);
  const pushResults = await push(prod, local);
  return [...pullResults, ...pushResults];
}
