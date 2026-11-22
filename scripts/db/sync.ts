#!/usr/bin/env npx tsx
/**
 * Interactive database sync tool
 *
 * Usage:
 *   npx tsx scripts/db/sync.ts
 *   npm run db:sync
 */

import type pg from 'pg';
import readline from 'readline';
import dotenv from 'dotenv';
import {
  computeDiffs,
  pull,
  push,
  fullSync,
  type DiffResult,
  type SyncResult,
} from '../../lib/db/sync-core';
import { createPgClient } from '../../lib/db/pgClient';
import { PROD_DATABASE_VARIABLES, prodClientConfig, prodHostOf, readProdDatabase } from '../../lib/db/prodDatabase';
import { isEntryPoint } from '../shared/entryPoint';

interface SyncSession {
  prod: pg.Client;
  local: pg.Client;
  ask: (question: string) => Promise<string>;
}

function pad(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function renderCount(n: number | null): string {
  return n === null ? '?' : String(n);
}

function logSyncResult(r: SyncResult) {
  const skippedSuffix = r.skipped > 0 ? `, ${r.skipped} skipped` : '';
  const failedSuffix = r.failed > 0 ? `, ${r.failed} failed` : '';
  console.log(`  ${r.table}: ${r.rows} rows ${r.direction}${skippedSuffix}${failedSuffix}`);
}

function printDashboard(diffs: DiffResult[]) {
  console.log('\n  ' + pad('Table', 22) + padLeft('Local', 7) + padLeft('Prod', 7) + '   Status');
  console.log('  ' + '-'.repeat(60));

  for (const d of diffs) {
    const localStr = renderCount(d.localCount);
    const prodStr = renderCount(d.prodCount);
    const toPush = d.onlyLocal.length + d.localNewer;
    const toPull = d.onlyProd.length + d.prodNewer;
    let status = 'in sync';

    if (d.localCount === null || d.prodCount === null) {
      status = 'count unavailable';
    } else if (toPush > 0 && toPull > 0) {
      status = `${toPush} to push, ${toPull} to pull`;
    } else if (toPush > 0) {
      status = `${toPush} to push`;
    } else if (toPull > 0) {
      status = `${toPull} to pull`;
    } else if (d.localCount !== d.prodCount) {
      status = 'counts differ (same keys)';
    }

    const ok = toPush === 0 && toPull === 0
      && d.localCount !== null && d.prodCount !== null
      && d.localCount === d.prodCount;
    const marker = ok ? ' ' : '*';
    console.log(`${marker} ${pad(d.table, 22)}${padLeft(localStr, 7)}${padLeft(prodStr, 7)}   ${status}`);
  }
  console.log();
}

async function pullFromProd(prod: pg.Client, local: pg.Client) {
  console.log('\nPulling prod -> local...');
  const results = await pull(prod, local);
  for (const r of results) logSyncResult(r);
  console.log('Done.\n');
}

async function pushToProd({ prod, local, ask }: SyncSession, diffs: DiffResult[]) {
  const pending = diffs.filter(d => d.onlyLocal.length + d.localNewer > 0);
  if (pending.length === 0) {
    console.log('\nNothing to push - prod is up to date.\n');
    return;
  }

  console.log('\nWill push to prod:');
  for (const d of pending) {
    const newerSuffix = d.localNewer > 0 ? `, ${d.localNewer} newer` : '';
    console.log(`  ${d.table}: ${d.onlyLocal.length} new${newerSuffix}`);
    for (const id of d.onlyLocal.slice(0, 5)) {
      console.log(`    - ${id}`);
    }
    if (d.onlyLocal.length > 5) {
      console.log(`    ... and ${d.onlyLocal.length - 5} more`);
    }
  }

  const confirm = await ask('\nProceed? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.\n');
    return;
  }

  console.log('\nPushing local -> prod...');
  const results = await push(prod, local);
  for (const r of results) logSyncResult(r);
  console.log('Done.\n');
}

async function showDiff(diffs: DiffResult[]) {
  console.log('\n=== Detailed Diff ===\n');
  for (const d of diffs) {
    if (d.onlyLocal.length === 0 && d.onlyProd.length === 0 && d.localNewer === 0 && d.prodNewer === 0) continue;

    console.log(`${d.table}:`);
    if (d.onlyLocal.length > 0) {
      console.log('  Local only:');
      for (const id of d.onlyLocal) console.log(`    + ${id}`);
    }
    if (d.onlyProd.length > 0) {
      console.log('  Prod only:');
      for (const id of d.onlyProd) console.log(`    + ${id}`);
    }
    if (d.localNewer > 0) console.log(`  ${d.localNewer} row(s) newer on local`);
    if (d.prodNewer > 0) console.log(`  ${d.prodNewer} row(s) newer on prod`);
    console.log();
  }

  if (diffs.every(d => d.onlyLocal.length === 0 && d.onlyProd.length === 0 && d.localNewer === 0 && d.prodNewer === 0)) {
    console.log('Everything is in sync.\n');
  }
}

async function fullSyncInteractive({ prod, local, ask }: SyncSession, diffs: DiffResult[]) {
  const hasToPull = diffs.some(d => d.onlyProd.length + d.prodNewer > 0);
  const hasToPush = diffs.some(d => d.onlyLocal.length + d.localNewer > 0);

  if (!hasToPull && !hasToPush) {
    console.log('\nAlready in sync.\n');
    return;
  }

  console.log('\nFull sync will:');
  if (hasToPull) console.log('  - Pull newer/missing entries from prod -> local');
  if (hasToPush) console.log('  - Push newer/missing entries from local -> prod');

  const confirm = await ask('\nProceed? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.\n');
    return;
  }

  const results = await fullSync(prod, local);
  for (const r of results) logSyncResult(r);
  console.log('Done.\n');
}

async function main() {
  const prodDatabase = readProdDatabase(process.env);
  const localUrl = process.env.DATABASE_URL;
  if (!prodDatabase || !localUrl) {
    console.error(`Missing ${PROD_DATABASE_VARIABLES}, or DATABASE_URL, in .env.local`);
    process.exit(1);
  }

  console.log('=== Database Sync Tool ===\n');
  console.log(`Prod: ${prodHostOf(prodDatabase)}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string) => new Promise<string>(resolve => rl.question(question, resolve));
  const prod = createPgClient(prodClientConfig(prodDatabase), 'prod');
  const local = createPgClient({ connectionString: localUrl }, 'local');
  const session: SyncSession = { prod, local, ask };

  try {
    await prod.connect();
    await local.connect();
    console.log('Connected to both databases.');

    let diffs = await computeDiffs(prod, local);
    printDashboard(diffs);

    let running = true;
    while (running) {
      console.log('[1] Pull all from prod -> local');
      console.log('[2] Push missing to prod');
      console.log('[3] Show diff details');
      console.log('[4] Full sync (both directions)');
      console.log('[5] Refresh dashboard');
      console.log('[0] Exit\n');

      const choice = await ask('> ');

      switch (choice.trim()) {
        case '1':
          await pullFromProd(prod, local);
          diffs = await computeDiffs(prod, local);
          printDashboard(diffs);
          break;
        case '2':
          await pushToProd(session, diffs);
          diffs = await computeDiffs(prod, local);
          printDashboard(diffs);
          break;
        case '3':
          await showDiff(diffs);
          break;
        case '4':
          await fullSyncInteractive(session, diffs);
          diffs = await computeDiffs(prod, local);
          printDashboard(diffs);
          break;
        case '5':
          diffs = await computeDiffs(prod, local);
          printDashboard(diffs);
          break;
        case '0':
        case 'q':
          running = false;
          break;
        default:
          console.log('Invalid choice.\n');
      }
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prod.end();
    await local.end();
    rl.close();
  }
}

if (isEntryPoint(import.meta.url)) {
  dotenv.config({ path: '.env.local' });
  main();
}
