'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export const PULL_REFRESH_INTERVAL_MS = 30_000;

export function usePullRefresh(): void {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(refresh, PULL_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [router]);
}
