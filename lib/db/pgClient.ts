import { Client, type ClientConfig } from 'pg';

/**
 * A pg client that logs a lost connection instead of crashing the process. pg emits 'error' when
 * the server drops a connection no query is waiting on (DSQL drops one after a message over
 * 10 MiB), and an 'error' event with no listener kills Node. The next query on the client fails,
 * so the caller still sees the failure.
 */
export function createPgClient(config: ClientConfig, label: string): Client {
  const client = new Client(config);
  client.on('error', (error) => console.error(`[db] ${label} connection lost: ${error.message}`));
  return client;
}
