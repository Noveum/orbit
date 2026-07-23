'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import type { ReactNode } from 'react';
import { ConnectionBanner } from './connection-banner.tsx';
import { DeltaBridge } from './delta-bridge.tsx';
import { SessionProvider } from './session.tsx';

export interface WorkspaceRealtimeProps {
  readonly url: string;
  readonly token: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly teamIds: readonly string[];
  readonly children: ReactNode;
}

export function WorkspaceRealtime({
  url,
  token,
  userId,
  organizationId,
  teamIds,
  children,
}: WorkspaceRealtimeProps) {
  return (
    <SessionProvider userId={userId}>
      <RealtimeProvider url={url} token={token} organizationId={organizationId}>
        <DeltaBridge organizationId={organizationId} teamIds={teamIds} />
        {children}
        <ConnectionBanner />
      </RealtimeProvider>
    </SessionProvider>
  );
}
