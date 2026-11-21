import { PAGE_ROUTES } from '@/lib/constants';

/**
 * The login page naming the page the visitor was on in next, so the sign-in
 * returns there (see safeReturnPath). The middleware's redirect and the guest
 * sign-in links both use it. It keeps the path and query but not the hash,
 * which the middleware never sees.
 */
export function loginPathReturningTo(location: Pick<Location, 'pathname' | 'search'>): string {
  return `${PAGE_ROUTES.LOGIN}?${new URLSearchParams({ next: `${location.pathname}${location.search}` })}`;
}
