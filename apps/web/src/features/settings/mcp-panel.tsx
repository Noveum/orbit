'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { CopyRow, IntegrationCard, useCopy } from './integration-card.tsx';
import { type McpClient, mcpClients } from './mcp-install-links.ts';

export interface McpConnection {
  readonly id: string;
  readonly clientName: string;
  readonly organizationName: string;
  readonly lastUsedAt: string | null;
}

export interface McpPanelProps {
  readonly mcpUrl: string;
  readonly connections: readonly McpConnection[];
}

const MCP_DESCRIPTION =
  'Connect a compatible AI client to Orbit. The client signs in with your Orbit account and acts as you, within your permissions. No API key needed.';

function formatLastUsed(iso: string | null): string {
  if (iso === null) return 'Never used yet';
  return `Last used ${new Date(iso).toLocaleDateString()}`;
}

export function McpPanel({ mcpUrl, connections }: McpPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function disconnect(grantId: string): Promise<void> {
    setError(null);
    try {
      await apiRequest(`/api/integrations/mcp?grantId=${encodeURIComponent(grantId)}`, {
        method: 'DELETE',
        body: {},
      });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <IntegrationCard
      title="MCP server"
      description={MCP_DESCRIPTION}
      status={<Badge tone="accent">OAuth</Badge>}
    >
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-faint">Server URL</span>
        <CopyRow value={mcpUrl} label="Copy MCP server URL" testId="mcp-url" onError={setError} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-2xs text-faint">Add Orbit to a client</span>
        <ul className="grid gap-2 sm:grid-cols-2">
          {mcpClients(mcpUrl).map((client) => (
            <McpClientTile key={client.id} client={client} mcpUrl={mcpUrl} onError={setError} />
          ))}
        </ul>
        <p className="text-2xs text-faint">
          Ask the client to call get_me once it is connected, to confirm it can reach Orbit.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-2xs text-faint">Connected clients</span>
        <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
          {connections.length === 0 ? (
            <li className="px-3 py-2.5 text-faint text-xs">No clients connected yet.</li>
          ) : (
            connections.map((connection) => (
              <li
                key={connection.id}
                className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-dense text-text">{connection.clientName}</span>
                  <span className="text-2xs text-faint">
                    {connection.organizationName}, {formatLastUsed(connection.lastUsedAt)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Disconnect ${connection.clientName}`}
                  onClick={() => disconnect(connection.id)}
                >
                  Disconnect
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
    </IntegrationCard>
  );
}

function McpClientTile({
  client,
  mcpUrl,
  onError,
}: {
  client: McpClient;
  mcpUrl: string;
  onError: (message: string) => void;
}) {
  const action = client.action;

  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
      data-testid={`mcp-client-${client.id}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-dense text-text">{client.name}</span>
        <span className="text-2xs text-faint">{client.summary}</span>
      </div>

      {action.kind === 'command' ? (
        <CopyRow
          value={action.command}
          label={`Copy the ${client.name} command`}
          onError={onError}
        />
      ) : null}

      {action.kind === 'url' ? (
        <CopyRow
          value={action.url}
          label={`Copy the Orbit server URL for ${client.name}`}
          onError={onError}
        />
      ) : null}

      {action.kind === 'deeplink' ? (
        <Button asChild variant="secondary" size="sm" className="w-fit">
          <a href={action.href}>Add to {client.name}</a>
        </Button>
      ) : null}

      {action.kind === 'open' ? (
        <ConnectorButton name={client.name} href={action.href} mcpUrl={mcpUrl} onError={onError} />
      ) : null}

      <ol className="flex list-inside list-decimal flex-col gap-0.5 text-2xs text-muted">
        {client.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </li>
  );
}

function ConnectorButton({
  name,
  href,
  mcpUrl,
  onError,
}: {
  name: string;
  href: string;
  mcpUrl: string;
  onError: (message: string) => void;
}) {
  const { copied, copy } = useCopy(onError);

  async function openConnector(): Promise<void> {
    const copying = copy(mcpUrl);
    window.open(href, '_blank', 'noopener,noreferrer');
    await copying;
  }

  return (
    <Button variant="secondary" size="sm" className="w-fit" onClick={openConnector}>
      {copied ? `URL copied, opening ${name}` : `Copy URL and open ${name}`}
    </Button>
  );
}
