const HOME_PATH = '/';
const LOGIN_PATHS = new Set(['/login', '/login/']);
// Any origin works here: parsing against it only shows whether a path stays on the site.
const PARSE_ORIGIN = 'http://return-path.invalid';
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

// "//host" and "/\host" are links to another site, and browsers drop tabs and
// newlines from URLs, so "/\t/host" would become one.
function isSitePath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.startsWith('/\\')) return false;
  return !CONTROL_CHARACTER.test(path);
}

function decodeOrNull(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * Where the login page sends a visitor after sign-in: the page they were sent
 * away from, when it is a path on this site, and home otherwise. The path must
 * also stay on this site once decoded, so an encoded "//host" goes home too, and
 * the login page itself goes home so a sign-in never lands back on it.
 */
export function safeReturnPath(next: string | null): string {
  if (!next || !isSitePath(next)) return HOME_PATH;
  const decoded = decodeOrNull(next);
  if (decoded === null || !isSitePath(decoded)) return HOME_PATH;

  const url = new URL(next, PARSE_ORIGIN);
  if (url.origin !== PARSE_ORIGIN || LOGIN_PATHS.has(url.pathname)) return HOME_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}
