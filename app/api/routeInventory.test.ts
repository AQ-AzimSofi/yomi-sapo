import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { AccessPolicy } from '@/lib/auth/guards';

// Importing every route must not open a database connection.
vi.mock('@/lib/db/connection', () => ({ sql: vi.fn() }));

const API_DIR = fileURLToPath(new URL('.', import.meta.url));
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const ACCESS_POLICIES: readonly unknown[] = ['owner', 'viewer', 'admin-key', 'public'] satisfies AccessPolicy[];

// The policy of every handler, so a new handler or a changed policy needs a deliberate
// edit here. Anyone may call a public handler; say why next to it.
const EXPECTED_POLICIES: Record<string, AccessPolicy> = {
  'admin POST': 'admin-key',
  'auth GET': 'viewer',
  'auth POST': 'public', // login and logout
  'book-assets GET': 'viewer',
  'covers GET': 'public', // publishers' cover art; CloudFront caches it for everyone anyway
  'db-sync GET': 'owner',
  'db-sync POST': 'owner',
  'explain-sentence POST': 'viewer',
  'health GET': 'public', // uptime check
  'init-db GET': 'viewer',
  'library-progress GET': 'viewer',
  'list-text-files GET': 'viewer',
  'narration GET': 'owner',
  'prioritize POST': 'viewer',
  'read-bookmark GET': 'owner',
  'read-public-txt GET': 'viewer',
  'ruby-registry DELETE': 'owner',
  'ruby-registry GET': 'viewer',
  'ruby-registry POST': 'owner',
  'text-entries PUT': 'public', // answers 404 outside the local dev server, where the book pipeline calls it
  'translate POST': 'viewer',
  'tts POST': 'viewer',
  'vocabulary GET': 'owner',
  'vocabulary POST': 'owner',
  'vocabulary/[id] DELETE': 'owner',
  'vocabulary/[id] GET': 'owner',
  'vocabulary/[id] PUT': 'owner',
  'write-bookmark POST': 'owner',
};

interface RouteHandler {
  route: string;
  method: string;
  policy: unknown;
}

function listRouteFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: 'utf8' })
    .filter((entry) => path.basename(entry) === 'route.ts')
    .map((entry) => entry.split(path.sep).join('/'))
    .sort();
}

function policyOf(handler: unknown): unknown {
  return typeof handler === 'function' && 'accessPolicy' in handler ? handler.accessPolicy : undefined;
}

async function loadHandlers(routeFile: string): Promise<RouteHandler[]> {
  const routeModule: Record<string, unknown> = await import(/* @vite-ignore */ pathToFileURL(path.join(API_DIR, routeFile)).href);
  const route = path.posix.dirname(routeFile);
  return HTTP_METHODS.filter((method) => method in routeModule).map((method) => ({
    route,
    method,
    policy: policyOf(routeModule[method]),
  }));
}

const ROUTE_FILES = listRouteFiles();

describe('API route inventory', () => {
  it('finds the route files', () => {
    expect(ROUTE_FILES).toContain('health/route.ts');
    expect(ROUTE_FILES).toContain('vocabulary/[id]/route.ts');
  });

  it.each(ROUTE_FILES)('%s declares an access policy on every handler it exports', async (routeFile) => {
    const handlers = await loadHandlers(routeFile);

    expect(handlers.length).toBeGreaterThan(0);
    const undeclared = handlers.filter(({ policy }) => !ACCESS_POLICIES.includes(policy));
    expect(undeclared).toStrictEqual([]);
  });

  it('gives every handler the policy the table expects', async () => {
    const handlers = (await Promise.all(ROUTE_FILES.map(loadHandlers))).flat();

    const policies = Object.fromEntries(handlers.map(({ route, method, policy }) => [`${route} ${method}`, policy]));
    expect(policies).toStrictEqual(EXPECTED_POLICIES);
  });
});
