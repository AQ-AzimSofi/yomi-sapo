'use client';

import { useEffect, useState } from 'react';
import { clearGuestKeys } from '@/lib/guestKeys';
import { fetchSession } from '@/lib/api/client';

interface GuestModeState {
  isGuest: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Reports whether the current visitor is signed in. Until the session check
 * resolves, isGuest stays false so guest-only UI never flashes for real users.
 */
export function useGuestMode(): GuestModeState {
  const [isGuest, setIsGuest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const data = await fetchSession();
        // Only show guest UI when the server explicitly reports no session; on a
        // failed/non-JSON check assume signed-in so the owner's chrome is never
        // degraded. Clear any stale guest keys once a session is confirmed.
        if (active) {
          setIsGuest(data.authenticated === false);
          if (data.authenticated === true) clearGuestKeys();
        }
      } catch {
        if (active) setIsGuest(false);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    checkSession();
    return () => {
      active = false;
    };
  }, []);

  return {
    isGuest,
    isAuthenticated: !isLoading && !isGuest,
    isLoading,
  };
}
