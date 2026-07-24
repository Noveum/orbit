'use client';

import { useRealtimeStatus } from '@orbit/realtime-client/react';
import { Button } from '@/components/ui/button.tsx';

export function ConnectionBanner() {
  const status = useRealtimeStatus();
  if (status !== 'closed' && status !== 'reconnecting') return null;

  const closed = status === 'closed';
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
