'use client';

import Link from 'next/link';
import { THEME } from '@/lib/constants';
import { toTint } from '@/lib/utils/colorTint';

interface GuestModeBannerProps {
  message?: string;
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
        <Link
          href="/login"
          className="text-sm font-bold whitespace-nowrap underline underline-offset-4 interactive-link"
          style={{ color: THEME.PRIMARY }}
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
