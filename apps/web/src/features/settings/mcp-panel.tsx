'use client';

import type { AgentSettingsView } from '@orbit/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { CopyRow, IntegrationCard, useCopy } from './integration-card.tsx';
import { type McpClient, mcpClients } from './mcp-install-links.ts';

export interface McpConnection {
  readonly id: string;
  readonly agentIdentityId?: string | null;
  readonly clientName: string;
  readonly organizationName: string;
  readonly lastUsedAt: string | null;
}

export interface McpPanelProps {
  readonly mcpUrl: string;
  readonly connections: readonly McpConnection[];
  readonly agents?: {
    readonly yourAgents: readonly AgentSettingsView[];
    readonly workspaceAgents: readonly AgentSettingsView[];
    readonly activeQuotaUsed: number;
    readonly activeQuotaLimit: number;
  } | null;
}

const MCP_DESCRIPTION =
  'Connect a compatible client to Orbit. Each connection runs as an agent identity within your current permissions. No API key needed.';

function formatLastUsed(iso: string | null): string {
  if (iso === null) return 'Never used yet';
  return `Last used ${new Date(iso).toLocaleDateString()}`;
}

export function McpPanel({ mcpUrl, connections, agents }: McpPanelProps) {
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

  async function manage(
    agent: AgentSettingsView,
    action: 'pause' | 'resume' | 'revoke_connection' | 'delete' | 'update_profile',
    value?: string,
    avatar: string | null = agent.avatar,
  ): Promise<void> {
    if ((action === 'delete' || action === 'update_profile') && !value?.trim()) return;
    setError(null);
    try {
      let body: Record<string, unknown> = { action };
      if (action === 'delete') body = { action, reason: value };
      if (action === 'update_profile') {
        body = { action, profile: { name: value, avatar } };
      }
      await apiRequest(`/api/integrations/mcp/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        body,
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
                  {connection.agentIdentityId === null ? (
                    <span className="text-2xs text-warning">
                      Action required: reconnect and choose an agent identity.
                    </span>
                  ) : null}
                </span>
                {connection.agentIdentityId === null ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Disconnect ${connection.clientName}`}
                    onClick={() => disconnect(connection.id)}
                  >
                    Disconnect
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
      </div>

      {agents === undefined || agents === null ? null : (
        <div className="flex flex-col gap-3" data-testid="mcp-agents">
          <div className="flex items-center justify-between gap-3">
            <span className="text-2xs text-faint">Your agents</span>
            <span className="text-2xs text-muted">
              Active {agents.activeQuotaUsed} of {agents.activeQuotaLimit}
            </span>
          </div>
          {agents.yourAgents.length === 0 ? (
            <p className="text-faint text-xs">No agents yet. Connect a client to create one.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {agents.yourAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} onManage={manage} />
              ))}
            </ul>
          )}
          {agents.workspaceAgents.length === 0 ? null : (
            <>
              <span className="text-2xs text-faint">Workspace agents</span>
              <ul className="flex flex-col gap-2">
                {agents.workspaceAgents.map((agent) => (
                  <AgentCard key={`workspace-${agent.id}`} agent={agent} onManage={manage} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </IntegrationCard>
  );
}

type ManageAgent = (
  agent: AgentSettingsView,
  action: 'pause' | 'resume' | 'revoke_connection' | 'delete' | 'update_profile',
  value?: string,
  avatar?: string | null,
) => Promise<void>;

function AgentProfileControls({
  agent,
  onManage,
}: {
  readonly agent: AgentSettingsView;
  readonly onManage: ManageAgent;
}) {
  const [profileName, setProfileName] = useState(agent.name);
  const uploadedOwnerAvatar =
    agent.owner.avatar !== null && /^\/api\/avatars\/[^/?#]+\?v=\d+$/.test(agent.owner.avatar)
      ? agent.owner.avatar
      : null;
  return (
    <>
      <input
        className="min-w-28 rounded border border-border bg-surface px-2 text-xs text-text"
        aria-label={`Name for ${agent.name}`}
        value={profileName}
        onChange={(event) => setProfileName(event.target.value)}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={profileName.trim() === '' || profileName.trim() === agent.name}
        onClick={() => onManage(agent, 'update_profile', profileName)}
      >
        Save name
      </Button>
      {uploadedOwnerAvatar === null || uploadedOwnerAvatar === agent.avatar ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onManage(agent, 'update_profile', profileName, uploadedOwnerAvatar)}
        >
          Use profile avatar
        </Button>
      )}
      {agent.avatar === null ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onManage(agent, 'update_profile', profileName, null)}
        >
          Remove avatar
        </Button>
      )}
    </>
  );
}

function AgentCard({
  agent,
  onManage,
}: {
  readonly agent: AgentSettingsView;
  readonly onManage: ManageAgent;
}) {
  const [deleteReason, setDeleteReason] = useState('');
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
      data-testid={`mcp-agent-${agent.id}`}
    >
      <div className="flex items-center gap-2">
        <Avatar name={agent.name} src={agent.avatar} size="sm" />
        <span className="font-medium text-dense text-text">{agent.name}</span>
        <Badge tone="accent">Agent</Badge>
        {agent.lifecycle === 'deleted' ? <Badge tone="outline">Deleted</Badge> : null}
      </div>
      <p className="text-2xs text-muted">
        Owner: {agent.owner.name}. Client: {agent.client.name}.
      </p>
      <p className="text-2xs text-muted">
        Lifecycle: {agent.lifecycle}. Connection: {agent.connection}. Owner lock:{' '}
        {agent.ownerLocked ? 'on' : 'off'}. Admin lock: {agent.adminLocked ? 'on' : 'off'}.
      </p>
      <p className="text-2xs text-muted">
        Granted scopes: {agent.grant?.scopes.join(', ') || 'none'}. Workspace effective permissions:{' '}
        {agent.effectivePermissions.join(', ') || 'none'}.
      </p>
      <p className="text-2xs text-muted">
        Open issues: {agent.openIssueCount}. {formatLastUsed(agent.lastUsedAt)}. Last acted:{' '}
        {agent.lastActedAt === null ? 'Never' : new Date(agent.lastActedAt).toLocaleDateString()}.
      </p>
      {agent.recentActivity.length === 0 ? null : (
        <ul className="text-2xs text-muted">
          {agent.recentActivity.map((entry) => (
            <li key={entry.id}>
              {entry.identifier}: {entry.field}
            </li>
          ))}
        </ul>
      )}
      {agent.viewerAuthority === null || agent.lifecycle === 'deleted' ? null : (
        <div className="flex flex-wrap gap-1">
          {agent.viewerAuthority === 'owner' ? (
            <AgentProfileControls agent={agent} onManage={onManage} />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onManage(agent, agent.lifecycle === 'active' ? 'pause' : 'resume')}
          >
            {agent.lifecycle === 'active' ? 'Pause' : 'Resume'}
          </Button>
          {agent.connection === 'connected' ? (
            <Button variant="ghost" size="sm" onClick={() => onManage(agent, 'revoke_connection')}>
              Revoke connection
            </Button>
          ) : null}
          <input
            className="min-w-28 rounded border border-border bg-surface px-2 text-xs text-text"
            aria-label={`Reason for deleting ${agent.name}`}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Deletion reason"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteReason.trim() === ''}
            onClick={() => onManage(agent, 'delete', deleteReason)}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

export function McpClientTile({
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
