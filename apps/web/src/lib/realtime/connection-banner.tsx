'use client';

import type { RealtimeStatus } from '@orbit/realtime-client';
import { useRealtimeStatus } from '@orbit/realtime-client/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';

export const RECONNECT_GRACE_MS = 4_000;

export function ConnectionBanner() {
  return <ConnectionBannerView status={useRealtimeStatus()} />;
}

export function ConnectionBannerView({ status }: { readonly status: RealtimeStatus }) {
  const closed = status === 'closed';
  const reconnecting = status === 'reconnecting';
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (!reconnecting) {
      setGraceElapsed(false);
      return;
    }
    const timer = setTimeout(() => setGraceElapsed(true), RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [reconnecting]);

  if (!(closed || (reconnecting && graceElapsed))) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="realtime-connection-banner"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-border border-t bg-surface-2 px-4 py-2 text-dense text-muted"
    >
      <span>
        {closed
          ? 'Live updates stopped. Your session is no longer valid.'
          : 'Reconnecting to live updates.'}
      </span>
      {closed ? (
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          Reconnect
        </Button>
      ) : null}
    </div>
  );
}
