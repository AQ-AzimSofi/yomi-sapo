/**
 * The code an error carries: the SQLSTATE of a postgres.js or pg database error, or a Node system
 * error code such as ECONNRESET. Undefined for anything without a string code.
 */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

// SQLSTATE undefined_table: the statement names a table the database does not have.
const UNDEFINED_TABLE = '42P01';

export function isUndefinedTable(error: unknown): boolean {
  return errorCodeOf(error) === UNDEFINED_TABLE;
}
