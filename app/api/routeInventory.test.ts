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

// Handlers anyone may call without a session or an admin key. Adding one here is a
// deliberate decision; say why next to it.
const PUBLIC_HANDLERS = [
  'auth POST', // login and logout
  'covers GET', // publishers' cover art; CloudFront caches it for everyone anyway
  'health GET', // uptime check
  'text-entries PUT', // answers 404 outside the local dev server, where the book pipeline calls it
];

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

  it('keeps public only the handlers on the allowlist', async () => {
    const handlers = (await Promise.all(ROUTE_FILES.map(loadHandlers))).flat();

    const publicHandlers = handlers
      .filter(({ policy }) => policy === 'public')
      .map(({ route, method }) => `${route} ${method}`)
      .sort();
    expect(publicHandlers).toStrictEqual([...PUBLIC_HANDLERS].sort());
  });
});
