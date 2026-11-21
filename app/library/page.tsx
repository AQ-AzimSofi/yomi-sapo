'use client';

import { useState } from 'react';
import { COLORS, PAGE_ROUTES } from '@/lib/constants';
import { useGuestMode } from '@/app/hooks/useGuestMode';
import GuestModeBanner from '@/app/components/ui/GuestModeBanner';
import AppHeader, { NAV_ITEM_CLASS } from '@/app/components/ui/AppHeader';
import LibraryGrid from './components/LibraryGrid';
import DbSyncModal from './components/DbSyncModal';
import Link from 'next/link';

export default function LibraryPage() {
  const [showSync, setShowSync] = useState(false);
  const { isGuest } = useGuestMode();

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: COLORS.BASE, color: COLORS.INK }}
    >
      {isGuest && (
        <GuestModeBanner message="A few books are available as a free preview. Sign in for the full library." />
      )}

      <div className="max-w-[1120px] mx-auto px-5 sm:px-8 pb-14">
        <AppHeader
          currentPage="library"
          isGuest={isGuest}
          extraActions={
            <>
              <Link href={PAGE_ROUTES.TEXT_INPUT_AI} className={NAV_ITEM_CLASS}>
                テキスト追加
              </Link>
              <button onClick={() => setShowSync(true)} className={NAV_ITEM_CLASS}>
                同期
              </button>
            </>
          }
        />

        <main>
          <LibraryGrid />
        </main>
      </div>

      {showSync && <DbSyncModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
