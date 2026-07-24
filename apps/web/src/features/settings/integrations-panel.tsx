'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { IntegrationPicker, type PickerItem } from './integration-picker.tsx';
import type {
  ConnectedChannel,
  IntegrationSettings,
  IntegrationTeam,
  LinkedRepository,
} from './integrations-data.ts';
import { claudeCodeCommand, cursorInstallHref, vscodeInstallHref } from './mcp-install-links.ts';
import {
  type PickerChannel,
  type PickerRepository,
  useChannelSearch,
  useRepositorySearch,
} from './use-integration-lists.ts';

function teamName(teams: readonly IntegrationTeam[], teamId: string | null): string {
  if (teamId === null) return 'Workspace-wide';
  return teams.find((team) => team.id === teamId)?.name ?? 'Unknown team';
}

export interface McpConnection {
  readonly id: string;
  readonly clientName: string;
  readonly organizationName: string;
  readonly lastUsedAt: string | null;
}

export interface IntegrationsPanelProps {
  readonly settings: IntegrationSettings;
  readonly canManage: boolean;
  readonly mcpUrl: string;
  readonly mcpConnections: readonly McpConnection[];
}

export function IntegrationsPanel({
  settings,
  canManage,
  mcpUrl,
  mcpConnections,
}: IntegrationsPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: string, body: Record<string, unknown>): Promise<void> {
    setError(null);
    try {
      await apiRequest(path, { method, body });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <GithubSection settings={settings} canManage={canManage} onCall={call} />
      <SlackSection settings={settings} canManage={canManage} onCall={call} />
      <McpSection mcpUrl={mcpUrl} connections={mcpConnections} onError={setError} onCall={call} />
    </div>
  );
}

type CallFn = (path: string, method: string, body: Record<string, unknown>) => Promise<void>;

function IntegrationCard({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-dense text-text">{title}</h3>
          {status}
        </div>
        <p className="text-muted text-xs">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <Badge tone="success">Connected</Badge>
  ) : (
    <Badge tone="outline">Not connected</Badge>
  );
}

function ConnectLink({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: 'primary' | 'secondary';
}) {
  return (
    <Button asChild variant={variant} className="w-fit">
      <a href={href}>{label}</a>
    </Button>
  );
}

function ConnectCta({
  canManage,
  enabled,
  href,
  label,
  pendingHint,
}: {
  canManage: boolean;
  enabled: boolean;
  href: string;
  label: string;
  pendingHint: string;
}) {
  if (!canManage) return null;
  if (!enabled) {
    return (
      <p className="rounded-lg border border-border border-dashed bg-surface-2 px-3 py-2 text-faint text-2xs">
        {pendingHint}
      </p>
    );
  }
  return <ConnectLink href={href} label={label} variant="primary" />;
}

function LinkedRepoRow({
  repo,
  teams,
  canManage,
  onCall,
}: {
  repo: LinkedRepository;
  teams: readonly IntegrationTeam[];
  canManage: boolean;
  onCall: CallFn;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-dense text-text">{repo.repositoryName}</span>
        <span className="text-2xs text-faint">{teamName(teams, repo.teamId)}</span>
      </span>
      {canManage ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onCall(
              `/api/integrations/github?repositoryId=${encodeURIComponent(repo.repositoryId)}`,
              'DELETE',
              {},
            )
          }
        >
          Unlink
        </Button>
      ) : null}
    </li>
  );
}

function RepoPicker({
  open,
  onOpenChange,
  settings,
  onCall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: IntegrationSettings;
  onCall: CallFn;
}) {
  const query = useRepositorySearch(open);
  const linkedIds = new Set(settings.repositories.map((repo) => repo.repositoryId));
  const byId = new Map<string, PickerRepository>();
  for (const page of query.data?.pages ?? []) {
    for (const repo of page.repositories) {
      if (!byId.has(repo.repositoryId)) byId.set(repo.repositoryId, repo);
    }
  }
  const items: PickerItem[] = [...byId.values()].map((repo) => ({
    id: repo.repositoryId,
    label: repo.repositoryName,
    linked: linkedIds.has(repo.repositoryId),
  }));

  return (
    <IntegrationPicker
      open={open}
      onOpenChange={onOpenChange}
      title="Link a repository"
      description="Search your installed repositories and map one to a team."
      searchPlaceholder="Search repositories…"
      items={items}
      isLoading={query.isLoading}
      isError={query.isError}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      teams={settings.teams}
      submitLabel="Link"
      onSubmit={async (item, teamId) => {
        const repo = byId.get(item.id);
        if (repo === undefined || teamId === null) return;
        await onCall('/api/integrations/github', 'POST', {
          repositoryId: repo.repositoryId,
          repositoryName: repo.repositoryName,
          installationId: repo.installationId,
          defaultBranch: repo.defaultBranch,
          teamId,
        });
      }}
    />
  );
}

function GithubSection({
  settings,
  canManage,
  onCall,
}: {
  settings: IntegrationSettings;
  canManage: boolean;
  onCall: CallFn;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <IntegrationCard
      title="GitHub"
      description="Install the Orbit GitHub App, then map each repository to a team. Orbit posts pull request updates on the matching issue and links issues from branch names and PR text such as ENG-42."
      status={<ConnectionBadge connected={settings.githubConnected} />}
    >
      {settings.githubConnected ? (
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
            {settings.repositories.length === 0 ? (
              <li className="px-3 py-2.5 text-faint text-xs">No repositories linked yet.</li>
            ) : (
              settings.repositories.map((repo) => (
                <LinkedRepoRow
                  key={repo.repositoryId}
                  repo={repo}
                  teams={settings.teams}
                  canManage={canManage}
                  onCall={onCall}
                />
              ))
            )}
          </ul>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                Link a repository
              </Button>
              <ConnectLink
                href="/api/integrations/github/start"
                label="Add or remove repositories on GitHub"
                variant="secondary"
              />
            </div>
          ) : null}
          {canManage ? (
            <RepoPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              settings={settings}
              onCall={onCall}
            />
          ) : null}
        </div>
      ) : (
        <ConnectCta
          canManage={canManage}
          enabled={settings.githubConnectEnabled}
          href="/api/integrations/github/start"
          label="Connect GitHub"
          pendingHint="Ask a workspace admin to finish configuring the GitHub App before connecting."
        />
      )}
    </IntegrationCard>
  );
}

function LinkedChannelRow({
  channel,
  teams,
  canManage,
  onCall,
}: {
  channel: ConnectedChannel;
  teams: readonly IntegrationTeam[];
  canManage: boolean;
  onCall: CallFn;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-dense text-text">#{channel.channelName}</span>
        <span className="text-2xs text-faint">{teamName(teams, channel.teamId)}</span>
      </span>
      {canManage ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onCall('/api/integrations/slack', 'POST', {
              action: 'disconnect',
              channelId: channel.channelId,
            })
          }
        >
          Disconnect
        </Button>
      ) : null}
    </li>
  );
}

function ChannelPicker({
  open,
  onOpenChange,
  settings,
  onCall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: IntegrationSettings;
  onCall: CallFn;
}) {
  const query = useChannelSearch(open);
  const connectedIds = new Set(settings.channels.map((channel) => channel.channelId));
  const byId = new Map<string, PickerChannel>();
  for (const page of query.data?.pages ?? []) {
    for (const channel of page.channels) {
      if (!byId.has(channel.channelId)) byId.set(channel.channelId, channel);
    }
  }
  const items: PickerItem[] = [...byId.values()].map((channel) => ({
    id: channel.channelId,
    label: `#${channel.channelName}`,
    linked: connectedIds.has(channel.channelId),
  }));

  return (
    <IntegrationPicker
      open={open}
      onOpenChange={onOpenChange}
      title="Connect a channel"
      description="Search channels Orbit can see and map one to a team, or the whole workspace."
      searchPlaceholder="Search channels…"
      items={items}
      isLoading={query.isLoading}
      isError={query.isError}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => query.fetchNextPage()}
      teams={settings.teams}
      allowWorkspace
      submitLabel="Connect"
      onSubmit={async (item, teamId) => {
        const channel = byId.get(item.id);
        if (channel === undefined) return;
        await onCall('/api/integrations/slack', 'POST', {
          action: 'connect',
          channelId: channel.channelId,
          channelName: channel.channelName,
          teamId,
        });
      }}
    />
  );
}

function SlackSection({
  settings,
  canManage,
  onCall,
}: {
  settings: IntegrationSettings;
  canManage: boolean;
  onCall: CallFn;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <IntegrationCard
      title="Slack"
      description="Add Orbit to your Slack workspace, then map a channel to a team. Orbit unfurls issue links and posts pull request updates. One channel per team, one team per channel."
      status={<ConnectionBadge connected={settings.slackHasToken} />}
    >
      {settings.slackHasToken ? (
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
            {settings.channels.length === 0 ? (
              <li className="px-3 py-2.5 text-faint text-xs">No channels connected yet.</li>
            ) : (
              settings.channels.map((channel) => (
                <LinkedChannelRow
                  key={channel.channelId}
                  channel={channel}
                  teams={settings.teams}
                  canManage={canManage}
                  onCall={onCall}
                />
              ))
            )}
          </ul>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                Connect a channel
              </Button>
              <ConnectLink
                href="/api/integrations/slack/start"
                label="Reconnect Slack"
                variant="secondary"
              />
            </div>
          ) : null}
          {canManage ? (
            <ChannelPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              settings={settings}
              onCall={onCall}
            />
          ) : null}
        </div>
      ) : (
        <ConnectCta
          canManage={canManage}
          enabled={settings.slackConnectEnabled}
          href="/api/integrations/slack/start"
          label="Add to Slack"
          pendingHint="Ask a workspace admin to finish configuring the Slack app before connecting."
        />
      )}
    </IntegrationCard>
  );
}

function CopyRow({
  value,
  label,
  testId,
  onError,
}: {
  value: string;
  label: string;
  testId?: string;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError('Could not copy to the clipboard. Select and copy it manually.');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code
        {...(testId === undefined ? {} : { 'data-testid': testId })}
        className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-dense text-text"
      >
        {value}
      </code>
      <Button variant="secondary" onClick={copy} aria-label={label}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function formatLastUsed(iso: string | null): string {
  if (iso === null) return 'Never used yet';
  return `Last used ${new Date(iso).toLocaleDateString()}`;
}

function McpSection({
  mcpUrl,
  connections,
  onError,
  onCall,
}: {
  mcpUrl: string;
  connections: readonly McpConnection[];
  onError: (message: string) => void;
  onCall: CallFn;
}) {
  return (
    <IntegrationCard
      title="MCP server"
      description="Connect an MCP-aware AI client to Orbit. Sign in with your Orbit account and choose a workspace: the client acts as you, within your permissions. No API key needed."
      status={<Badge tone="accent">OAuth</Badge>}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-faint">Server URL</span>
        <CopyRow value={mcpUrl} label="Copy MCP server URL" testId="mcp-url" onError={onError} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-faint">Add to Claude Code</span>
        <CopyRow
          value={claudeCodeCommand(mcpUrl)}
          label="Copy the Claude Code command"
          onError={onError}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={cursorInstallHref(mcpUrl)}>
          <Button variant="secondary" size="sm">
            Add to Cursor
          </Button>
        </a>
        <a href={vscodeInstallHref(mcpUrl)}>
          <Button variant="secondary" size="sm">
            Add to VS Code
          </Button>
        </a>
      </div>

      <ol className="flex flex-col gap-1 text-muted text-xs">
        <li>Add Orbit to your MCP client with a link above, or point it at the server URL.</li>
        <li>Your browser opens: sign in to Orbit, pick a workspace, and approve.</li>
        <li>Ask the client to call get_me to confirm the connection.</li>
      </ol>

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
                    {connection.organizationName} · {formatLastUsed(connection.lastUsedAt)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Disconnect ${connection.clientName}`}
                  onClick={() =>
                    onCall(
                      `/api/integrations/mcp?grantId=${encodeURIComponent(connection.id)}`,
                      'DELETE',
                      {},
                    )
                  }
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
