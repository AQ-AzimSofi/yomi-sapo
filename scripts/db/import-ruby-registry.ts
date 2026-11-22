#!/usr/bin/env npx tsx
/**
 * Loads every ruby-registry.json under a folder (public by default) into the ruby_registry_entries
 * table, which the word lookup panel and the registry page read. A file at
 * <folder>/bookv2-furigana/<book>/ruby-registry.json becomes the registry of directory
 * bookv2-furigana, book name <book>: the key the reader uses.
 *
 * It only adds the words the table lacks, so running it again changes nothing, and an owner's edit,
 * delete or ignore is never undone. Every file is checked before anything is written.
 *
 * Dry run by default. Local DATABASE_URL (localhost only) unless --prod, which needs
 * PROD_DSQL_ENDPOINT: production on Neon has no registry table, so --prod refuses it.
 *
 * Usage:
 *   npx tsx scripts/db/import-ruby-registry.ts [folder]                  # local, dry run
 *   npx tsx scripts/db/import-ruby-registry.ts [folder] --apply          # local, write
 *   npx tsx scripts/db/import-ruby-registry.ts [folder] --prod --apply   # Aurora DSQL production
 */

import { createPgClient } from '../../lib/db/pgClient';
import { prodClientConfig, prodHostOf, readProdDatabase } from '../../lib/db/prodDatabase';
import { isLocalDatabase } from './localDatabase';
import { describeImport, importRubyRegistry, parseImportArgs, readRegistryFiles, RUBY_REGISTRY_FILE } from './rubyRegistryImport';
import { isEntryPoint } from '../shared/entryPoint';
import { loadRepoEnv } from '../shared/repoPaths';

interface Connection {
  client: ReturnType<typeof createPgClient>;
  label: string;
}

function connectToProd(): Connection {
  const prodDatabase = readProdDatabase(process.env);
  if (prodDatabase?.kind !== 'dsql') {
    throw new Error('--prod needs PROD_DSQL_ENDPOINT: only Aurora DSQL production has the ruby_registry_entries table, Neon does not.');
  }
  return { client: createPgClient(prodClientConfig(prodDatabase), 'production'), label: `production (${prodHostOf(prodDatabase)})` };
}

function connectToLocal(): Connection {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env.local');
  const host = new URL(connectionString).hostname;
  if (!isLocalDatabase([host])) throw new Error(`refusing DATABASE_URL on ${host}: use --prod for production`);
  return { client: createPgClient({ connectionString }, 'local'), label: `local (${host})` };
}

export async function main(args: readonly string[]): Promise<void> {
  const { root, isProd, shouldApply } = parseImportArgs(args);
  const files = await readRegistryFiles(root);
  const { client, label } = isProd ? connectToProd() : connectToLocal();
  await client.connect();

  try {
    console.log(`Target: ${label}`);
    console.log(`Found ${files.length} ${RUBY_REGISTRY_FILE} files under ${root}`);
    const report = await importRubyRegistry(client, files, shouldApply);
    describeImport(files, report).forEach((line) => console.log(line));
  } finally {
    await client.end();
  }
}

if (isEntryPoint(import.meta.url)) {
  loadRepoEnv();
  main(process.argv.slice(2)).catch((error) => {
    console.error('import-ruby-registry failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
