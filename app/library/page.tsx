'use client';

import { useState } from 'react';
import { COLORS } from '@/lib/constants';
import { useGuestMode } from '@/app/hooks/useGuestMode';
import GuestModeBanner from '@/app/components/ui/GuestModeBanner';
import AppHeader, { NAV_ITEM_CLASS } from '@/app/components/ui/AppHeader';
import LibraryGrid from './components/LibraryGrid';
import DbSyncModal from './components/DbSyncModal';

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
            <button onClick={() => setShowSync(true)} className={NAV_ITEM_CLASS}>
              同期
            </button>
          }
        />

        <main>
          <h1 className="sr-only">本棚</h1>
          <LibraryGrid />
        </main>
      </div>

      {showSync && <DbSyncModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
