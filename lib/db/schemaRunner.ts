import type postgres from 'postgres';
import type { DatabaseKind } from './connectionConfig';
import { schemaStatementsFor } from './schema';

export type SchemaClient = Pick<postgres.Sql, 'unsafe'>;

type SchemaLog = (line: string) => void;

const ASYNC_INDEX = /^CREATE INDEX ASYNC\b/;

function firstLineOf(statement: string): string {
  return statement.split('\n')[0];
}

// DSQL answers CREATE INDEX ASYNC with the id of the job that builds the index, and with no
// row when the index already exists. The next statement may need the index, so wait for it.
async function waitForIndexJob(client: SchemaClient, answer: readonly postgres.Row[], statement: string): Promise<void> {
  const jobId: unknown = answer[0]?.job_id;
  if (!jobId) return;
  const [job] = await client.unsafe('CALL sys.wait_for_job($1)', [String(jobId)]);
  if (job?.succeeded !== true) throw new Error(`index job ${String(jobId)} did not succeed: ${firstLineOf(statement)}`);
}

// A failed DSQL build leaves its index behind, marked invalid, and CREATE INDEX ASYNC IF NOT
// EXISTS then skips it without starting a job. So a run after a failure checks validity itself.
async function assertNoInvalidIndexes(client: SchemaClient): Promise<void> {
  const invalid = await client.unsafe(`
    SELECT index_class.relname AS index_name
    FROM pg_index
    JOIN pg_class AS index_class ON index_class.oid = pg_index.indexrelid
    JOIN pg_namespace ON pg_namespace.oid = index_class.relnamespace
    WHERE pg_namespace.nspname = current_schema() AND NOT pg_index.indisvalid
  `);
  if (invalid.length === 0) return;
  const names = invalid.map((row) => String(row.index_name)).join(', ');
  throw new Error(`invalid indexes left by a failed build: ${names}. Drop them as admin and run again.`);
}

/**
 * Applies the schema for the kind of database, one statement per call and in order, and stops at
 * the first error. Each statement is sent without parameters, so postgres.js uses the simple query
 * protocol and waits for the commit: an error DSQL raises at commit is reported, not dropped.
 * Plain PostgreSQL has no CREATE INDEX ASYNC, so there the index is built before the call returns.
 */
export async function applySchema(client: SchemaClient, kind: DatabaseKind, log: SchemaLog = () => undefined): Promise<void> {
  for (const statement of schemaStatementsFor(kind)) {
    const sent = kind === 'dsql' ? statement : statement.replace(ASYNC_INDEX, 'CREATE INDEX');
    const answer = await client.unsafe(sent);
    if (kind === 'dsql') await waitForIndexJob(client, answer, sent);
    log(firstLineOf(sent));
  }
  if (kind === 'dsql') await assertNoInvalidIndexes(client);
}
