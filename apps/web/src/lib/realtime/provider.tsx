'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import { SESSION_REVOKED_CLOSE_CODE, UNAUTHORIZED_CLOSE_CODE } from '@orbit/shared/events';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { authClient } from '@/lib/auth/client.ts';
import { ConnectionBanner } from './connection-banner.tsx';
import { DeltaBridge } from './delta-bridge.tsx';
import { SessionProvider } from './session.tsx';
import { fetchRealtimeTicket } from './ticket.ts';
import { resolveRealtimeUrl } from './url.ts';

const SIGNED_OUT_CLOSE_CODES: readonly number[] = [
  SESSION_REVOKED_CLOSE_CODE,
  UNAUTHORIZED_CLOSE_CODE,
];

export interface WorkspaceRealtimeProps {
  readonly url: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly teamIds: readonly string[];
  readonly children: ReactNode;
}

export function WorkspaceRealtime({
  url,
  userId,
  organizationId,
  teamIds,
  children,
}: WorkspaceRealtimeProps) {
  const handleTerminal = useCallback((code: number) => {
    if (!SIGNED_OUT_CLOSE_CODES.includes(code)) return;
    authClient.signOut().finally(() => {
      window.location.href = '/login';
    });
  }, []);

  const fetchTicket = useCallback(() => fetchRealtimeTicket(organizationId), [organizationId]);

  const socketUrl =
    typeof window === 'undefined' ? url : resolveRealtimeUrl(url, window.location.origin);

  return (
    <SessionProvider userId={userId}>
      <RealtimeProvider
        url={socketUrl}
        organizationId={organizationId}
        fetchTicket={fetchTicket}
        onTerminal={handleTerminal}
      >
        <DeltaBridge organizationId={organizationId} teamIds={teamIds} />
        {children}
        <ConnectionBanner />
      </RealtimeProvider>
    </SessionProvider>
  );
}
