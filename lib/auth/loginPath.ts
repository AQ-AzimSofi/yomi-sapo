import { PAGE_ROUTES } from '@/lib/constants';

/**
 * The login page for a visitor who chose to sign in, naming the page they were
 * on in next so the sign-in returns there (see safeReturnPath). Like the
 * middleware's redirect, it keeps the path and query but not the hash.
 */
export function loginPathReturningTo(location: Pick<Location, 'pathname' | 'search'>): string {
  return `${PAGE_ROUTES.LOGIN}?${new URLSearchParams({ next: `${location.pathname}${location.search}` })}`;
}
