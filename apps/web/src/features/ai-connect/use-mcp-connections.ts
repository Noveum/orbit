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

async function fetchConnections(): Promise<McpConnectionsState> {
  try {
    const { connections } = connectionsResponseSchema.parse(
      await apiRequest<unknown>('/api/integrations/mcp'),
    );
    return { connections, error: null };
  } catch (caught) {
    const error =
      caught instanceof z.ZodError ? 'Unexpected response from Orbit.' : messageOf(caught);
    return { connections: [], error };
  }
}

export function useMcpConnections(): McpConnectionsState {
  const [state, setState] = useState<McpConnectionsState>({ connections: [], error: null });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const timer = window.setInterval(onTrigger, MCP_CONNECTION_POLL_MS);

    function stop(): void {
      window.clearInterval(timer);
      window.removeEventListener('focus', onTrigger);
      document.removeEventListener('visibilitychange', onTrigger);
    }

    async function refresh(): Promise<void> {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      const result = await fetchConnections();
      inFlight = false;
      if (!active) return;
      if (result.error === null) {
        setState(result);
        if (result.connections.length > 0) stop();
      } else {
        const { error } = result;
        setState((previous) => ({ ...previous, error }));
      }
    }

    function onTrigger(): void {
      refresh().catch(() => undefined);
    }

    onTrigger();
    window.addEventListener('focus', onTrigger);
    document.addEventListener('visibilitychange', onTrigger);
    return () => {
      active = false;
      stop();
    };
  }, []);

  return state;
}
