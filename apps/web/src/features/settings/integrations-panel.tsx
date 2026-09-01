'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { GithubPanel } from './github-panel.tsx';
import { IntegrationCard } from './integration-card.tsx';
import { IntegrationPicker, type PickerItem } from './integration-picker.tsx';
import type {
  ConnectedChannel,
  IntegrationSettings,
  IntegrationTeam,
  SlackIntegrationSettings,
} from './integrations-data.ts';
import { type McpConnection, McpPanel } from './mcp-panel.tsx';
import { type PickerChannel, useChannelSearch } from './use-integration-lists.ts';

function teamName(teams: readonly IntegrationTeam[], teamId: string | null): string {
  if (teamId === null) return 'Workspace-wide';
  return teams.find((team) => team.id === teamId)?.name ?? 'Unknown team';
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

  async function call(
    path: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<unknown | null> {
    setError(null);
    try {
      const payload = await apiRequest<unknown>(path, { method, body });
      router.refresh();
      return payload;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      {canManage ? (
        <>
          <IntegrationCard
            title="GitHub"
            description="Install the Orbit GitHub App on every organisation you work in, then associate each repository with a project, or with the workspace when no project owns it yet."
            status={<ConnectionBadge connected={settings.github.connected} />}
          >
            <GithubPanel settings={settings.github} canManage={canManage} onError={setError} />
          </IntegrationCard>
          {settings.slack === undefined ? null : (
            <SlackSection
              settings={settings.slack}
              canManage={canManage}
              onCall={call}
              onError={setError}
              onSyncSuccess={() => router.replace('/settings/integrations', { scroll: false })}
            />
          )}
        </>
      ) : (
        <WorkspaceIntegrationsWithheld />
      )}
      <McpPanel mcpUrl={mcpUrl} connections={mcpConnections} />
    </div>
  );
}

function WorkspaceIntegrationsWithheld() {
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="font-medium text-dense text-text">Workspace integrations</h3>
      <p className="text-muted text-xs" data-testid="integrations-withheld">
        Only workspace admins can see and manage connected providers. Your own MCP client
        connections are below.
      </p>
    </section>
  );
}

type CallFn = (
  path: string,
  method: string,
  body: Record<string, unknown>,
) => Promise<unknown | null>;

const slackMemberSyncResultSchema = z.object({
  eligible: z.number().int().nonnegative(),
  mapped: z.number().int().nonnegative(),
});

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
  settings: SlackIntegrationSettings;
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
        await onCall('/api/integrations/slack', 'POST', {
          action: 'connect',
          channelId: item.id,
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
  onError,
  onSyncSuccess,
}: {
  settings: SlackIntegrationSettings;
  canManage: boolean;
  onCall: CallFn;
  onError: (message: string | null) => void;
  onSyncSuccess: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  async function syncMembers(): Promise<void> {
    setSyncing(true);
    setSyncStatus(null);
    const payload = await onCall('/api/integrations/slack', 'POST', {
      action: 'sync_members',
    });
    setSyncing(false);
    if (payload === null) return;
    const parsed = slackMemberSyncResultSchema.safeParse(payload);
    if (!parsed.success) {
      onError('Slack returned an unexpected member sync response.');
      return;
    }
    setSyncStatus(
      `Slack member sync completed: ${parsed.data.mapped} of ${parsed.data.eligible} matched.`,
    );
    onSyncSuccess();
  }

  return (
    <IntegrationCard
      title="Slack"
      description="Add Orbit to your Slack workspace, then map a channel to a team. Orbit unfurls issue links and posts pull request updates. One channel per team, one team per channel."
      status={<ConnectionBadge connected={settings.slackHasToken} />}
    >
      {settings.slackHasToken ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-faint text-xs">
            {settings.memberSync.mapped} of {settings.memberSync.eligible} workspace members matched
            by email.
          </p>
          {settings.memberSync.ready ? null : (
            <p className="text-faint text-xs">Reconnect Slack to enable workspace member sync.</p>
          )}
          {syncStatus === null ? null : (
            <p role="status" className="text-success text-xs">
              {syncStatus}
            </p>
          )}
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
              {settings.memberSync.ready ? (
                <Button variant="secondary" size="sm" disabled={syncing} onClick={syncMembers}>
                  {syncing ? 'Syncing Slack members' : 'Sync Slack members'}
                </Button>
              ) : null}
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
