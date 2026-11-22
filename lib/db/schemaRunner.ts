import type postgres from 'postgres';
import { SCHEMA_STATEMENTS } from './schema';

export type SchemaClient = Pick<postgres.Sql, 'unsafe'>;

/** Applies the schema one statement per call, in order. */
export async function applySchema(client: SchemaClient): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await client.unsafe(statement);
  }
}
