'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { API_ROUTES, COLORS, PAGE_ROUTES } from '@/lib/constants';
import { clearBookTextCache } from '@/lib/bookTextCache';

type AppPage = 'library' | 'vocabulary';

interface AppHeaderProps {
  currentPage?: AppPage;
  isGuest?: boolean;
  extraActions?: ReactNode;
}

const NAV_ITEMS: ReadonlyArray<{ page: AppPage; label: string; href: string }> = [
  { page: 'library', label: '本棚', href: PAGE_ROUTES.LIBRARY },
  { page: 'vocabulary', label: '単語帳', href: PAGE_ROUTES.VOCABULARY },
];

export const NAV_ITEM_CLASS = 'py-3 cursor-pointer interactive-link';

async function signOut(): Promise<void> {
  await fetch(API_ROUTES.AUTH_LOGOUT, { method: 'POST' });
  await clearBookTextCache();
  window.location.href = PAGE_ROUTES.LOGIN;
}

export default function AppHeader({ currentPage, isGuest = false, extraActions }: AppHeaderProps) {
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-x-10 gap-y-2 py-5 border-b"
      style={{ borderColor: COLORS.INK }}
    >
      <Link href={PAGE_ROUTES.LIBRARY} className="flex items-baseline gap-3">
        <span className="font-mincho font-bold text-[28px] tracking-[0.04em]">よみサポ</span>
        <span className="text-xs tracking-[0.18em]" style={{ color: COLORS.SECONDARY }}>
          YOMI-SAPO
        </span>
      </Link>

      <nav
        aria-label="メイン"
        className={`flex-wrap items-center gap-x-7 text-[15px] ${isGuest ? 'hidden' : 'flex'}`}
      >
        {NAV_ITEMS.map((item) =>
          item.page === currentPage ? (
            <span
              key={item.page}
              aria-current="page"
              className="py-3 font-bold border-b-2"
              style={{ borderColor: COLORS.PRIMARY }}
            >
              {item.label}
            </span>
          ) : (
            <Link key={item.page} href={item.href} className={NAV_ITEM_CLASS}>
              {item.label}
            </Link>
          )
        )}
        {extraActions}
        <button onClick={signOut} className={NAV_ITEM_CLASS} style={{ color: COLORS.SECONDARY }}>
          ログアウト
        </button>
      </nav>
    </header>
  );
}
