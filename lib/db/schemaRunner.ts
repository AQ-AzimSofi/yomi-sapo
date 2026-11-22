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
}
