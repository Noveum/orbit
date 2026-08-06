'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import { SESSION_REVOKED_CLOSE_CODE } from '@orbit/shared/events';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { z } from 'zod';
import { authClient } from '@/lib/auth/client.ts';
import { ConnectionBanner } from './connection-banner.tsx';
import { DeltaBridge } from './delta-bridge.tsx';
import { SessionProvider } from './session.tsx';
import { fetchRealtimeTicket } from './ticket.ts';
import { resolveRealtimeUrl } from './url.ts';

export interface SessionGate {
  readonly getSession: (options: {
    readonly query: { readonly disableCookieCache: true };
  }) => Promise<unknown>;
  readonly signOut: () => Promise<unknown>;
}

const noSessionSchema = z.object({
  data: z.null(),
  error: z.null().optional(),
});

function serverHasNoSession(result: unknown): boolean {
  return noSessionSchema.safeParse(result).success;
}

export async function endSessionIfRevoked(gate: SessionGate = authClient): Promise<boolean> {
  const current = await gate
    .getSession({ query: { disableCookieCache: true } })
    .catch(() => undefined);
  if (!serverHasNoSession(current)) return false;
  await gate.signOut().catch(() => undefined);
  window.location.href = '/login';
  return true;
}

export function handleTerminalClose(code: number, gate: SessionGate = authClient): void {
  if (code !== SESSION_REVOKED_CLOSE_CODE) return;
  endSessionIfRevoked(gate).catch(() => undefined);
}

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
  const handleTerminal = useCallback((code: number) => handleTerminalClose(code), []);

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
