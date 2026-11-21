'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PAGE_ROUTES, THEME } from '@/lib/constants';
import { toTint } from '@/lib/utils/colorTint';
import { loginPathReturningTo } from '@/lib/auth/loginPath';

interface GuestModeBannerProps {
  message?: string;
}

function SignInLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="text-sm font-bold whitespace-nowrap underline underline-offset-4 interactive-link"
      style={{ color: THEME.PRIMARY }}
    >
      Sign in
    </Link>
  );
}

// The reader turns pages with history.pushState, which Next feeds back into
// useSearchParams, so the link keeps naming the page the guest is on.
function SignInLinkReturningHere() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const search = query ? `?${query}` : '';
  return <SignInLink href={loginPathReturningTo({ pathname, search })} />;
}

export default function GuestModeBanner({ message }: GuestModeBannerProps) {
  return (
    <div style={{ backgroundColor: toTint(THEME.PRIMARY, 8), borderBottom: `1px solid ${THEME.PRIMARY}` }}>
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm" style={{ color: THEME.SECONDARY_DARK }}>
          <span
            className="px-2 py-0.5 text-xs font-bold whitespace-nowrap"
            style={{ backgroundColor: THEME.PRIMARY, color: THEME.ON_PRIMARY }}
          >
            Guest mode
          </span>
          <span>
            {message || 'You are reading a free preview. Sign in for the full library.'}
          </span>
        </div>
        {/* A statically prerendered page such as /library needs a Suspense boundary
            around useSearchParams; the plain login link stands in until it resolves. */}
        <Suspense fallback={<SignInLink href={PAGE_ROUTES.LOGIN} />}>
          <SignInLinkReturningHere />
        </Suspense>
      </div>
    </div>
  );
}
