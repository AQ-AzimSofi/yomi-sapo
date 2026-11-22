/**
 * The code an error carries: the SQLSTATE of a postgres.js or pg database error, or a Node system
 * error code such as ECONNRESET. Undefined for anything without a string code.
 */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
