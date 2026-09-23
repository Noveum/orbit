'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiRequest, messageOf } from '@/lib/api/client.ts';

export const MCP_CONNECTION_POLL_MS = 4000;

const connectionsResponseSchema = z.object({
  connections: z.array(
    z.object({ id: z.string(), clientName: z.string(), organizationName: z.string() }),
  ),
});

export type ConnectedClient = z.infer<typeof connectionsResponseSchema>['connections'][number];

export interface McpConnectionsState {
  readonly connections: readonly ConnectedClient[];
  readonly error: string | null;
}

export function useMcpConnections(): McpConnectionsState {
  const [state, setState] = useState<McpConnectionsState>({ connections: [], error: null });

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      if (document.visibilityState === 'hidden') return;
      try {
        const { connections } = connectionsResponseSchema.parse(
          await apiRequest<unknown>('/api/integrations/mcp'),
        );
        if (active) setState({ connections, error: null });
      } catch (caught) {
        const message =
          caught instanceof z.ZodError ? 'Unexpected response from Orbit.' : messageOf(caught);
        if (active) setState((current) => ({ ...current, error: message }));
      }
    }

    function onVisible(): void {
      refresh().catch(() => undefined);
    }

    onVisible();
    const timer = window.setInterval(onVisible, MCP_CONNECTION_POLL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return state;
}
