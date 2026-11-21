import { useEffect, useState } from 'react';

/**
 * True from the first time `isOpen` is true. A panel mounted behind this loads
 * its code and data only when first used, then stays mounted so it can slide.
 */
export function useOpenedOnce(isOpen: boolean): boolean {
  const [hasOpened, setHasOpened] = useState(isOpen);

  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);

  return hasOpened || isOpen;
}
