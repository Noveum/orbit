'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  SESSION_REVOKED_CLOSE_CODE,
} from '@orbit/shared/events';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { z } from 'zod';
import { apiRequest } from '@/lib/api/client.ts';
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

export interface WorkspaceRecoveryGate {
  readonly listOrganizations: () => Promise<unknown>;
  readonly setActive: (input: { readonly organizationId: string }) => Promise<unknown>;
}

const noSessionSchema = z.object({
  data: z.null(),
  error: z.null().optional(),
});

const organizationsSchema = z.object({
  organizations: z.array(z.object({ id: z.string() })),
});

const activationSchema = z.object({ error: z.unknown().optional() }).passthrough();

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

function workspaceRecoveryGate(): WorkspaceRecoveryGate {
  return {
    listOrganizations: () => apiRequest<unknown>('/api/organizations'),
    setActive: async (input) => await authClient.organization.setActive(input),
  };
}

export async function recoverWorkspaceAfterForbidden(
  gate: WorkspaceRecoveryGate = workspaceRecoveryGate(),
): Promise<void> {
  try {
    const listed = organizationsSchema.parse(await gate.listOrganizations());
    const next = listed.organizations[0];
    if (next === undefined) {
      window.location.href = '/workspaces/new';
      return;
    }
    const activated = activationSchema.parse(await gate.setActive({ organizationId: next.id }));
    if (activated.error !== undefined && activated.error !== null) {
      throw new Error('Could not activate a surviving workspace.');
    }
    window.location.href = '/my-issues';
  } catch {
    window.location.href = '/workspaces/new';
  }
}

export function handleTerminalClose(
  code: number,
  sessionGate: SessionGate = authClient,
  recoveryGate: WorkspaceRecoveryGate = workspaceRecoveryGate(),
): void {
  if (code === SESSION_REVOKED_CLOSE_CODE) {
    endSessionIfRevoked(sessionGate).catch(() => undefined);
    return;
  }
  if (code === ORGANIZATION_FORBIDDEN_CLOSE_CODE) {
    recoverWorkspaceAfterForbidden(recoveryGate).catch(() => undefined);
  }
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
