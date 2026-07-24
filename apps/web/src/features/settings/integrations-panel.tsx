'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import type {
  ConnectedChannel,
  IntegrationSettings,
  IntegrationTeam,
  LinkedRepository,
} from './integrations-data.ts';

function teamName(teams: readonly IntegrationTeam[], teamId: string | null): string {
  if (teamId === null) return 'Workspace-wide';
  return teams.find((team) => team.id === teamId)?.name ?? 'Unknown team';
}

export interface IntegrationsPanelProps {
  readonly settings: IntegrationSettings;
  readonly canManage: boolean;
  readonly mcpUrl: string;
}

export function IntegrationsPanel({ settings, canManage, mcpUrl }: IntegrationsPanelProps) {
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
      <McpSection mcpUrl={mcpUrl} onError={setError} />
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

function TeamSelect({
  id,
  teams,
  value,
  onChange,
  allowWorkspace,
}: {
  id: string;
  teams: readonly IntegrationTeam[];
  value: string;
  onChange: (value: string) => void;
  allowWorkspace?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label="Team"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-md border border-border bg-surface px-2 text-dense text-text"
    >
      {allowWorkspace === true ? <option value="">Workspace-wide</option> : null}
      {teams.map((team) => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
    </select>
  );
}

interface RepoRow {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly defaultBranch: string;
  readonly installationId: string;
  readonly linked: LinkedRepository | null;
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
  const linkedById = new Map(settings.repositories.map((repo) => [repo.repositoryId, repo]));
  const availableIds = new Set(settings.availableRepositories.map((repo) => repo.repositoryId));
  const rows: RepoRow[] = [
    ...settings.availableRepositories.map((repo) => ({
      repositoryId: repo.repositoryId,
      repositoryName: repo.repositoryName,
      defaultBranch: repo.defaultBranch,
      installationId: repo.installationId,
      linked: linkedById.get(repo.repositoryId) ?? null,
    })),
    ...settings.repositories
      .filter((repo) => !availableIds.has(repo.repositoryId))
      .map((repo) => ({
        repositoryId: repo.repositoryId,
        repositoryName: repo.repositoryName,
        defaultBranch: 'main',
        installationId: '',
        linked: repo,
      })),
  ];

  return (
    <IntegrationCard
      title="GitHub"
      description="Install the Orbit GitHub App, then map each repository to a team. Orbit posts pull request updates on the matching issue and links issues from branch names and PR text such as ENG-42."
      status={<ConnectionBadge connected={settings.githubConnected} />}
    >
      {settings.githubConnected ? (
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
            {rows.length === 0 ? (
              <li className="px-3 py-2.5 text-faint text-xs">
                {settings.githubReposError
                  ? 'Could not load repositories from GitHub. Try again shortly.'
                  : 'No repositories are shared with Orbit yet. Add some on GitHub.'}
              </li>
            ) : (
              rows.map((repo) => (
                <RepoMappingRow
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
            <ConnectLink
              href="/api/integrations/github/start"
              label="Add or remove repositories on GitHub"
              variant="secondary"
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

function RepoAction({
  repo,
  teams,
  onCall,
}: {
  repo: RepoRow;
  teams: readonly IntegrationTeam[];
  onCall: CallFn;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');

  if (repo.linked !== null) {
    return (
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
    );
  }

  return (
    <span className="flex items-center gap-2">
      <TeamSelect
        id={`gh-team-${repo.repositoryId}`}
        teams={teams}
        value={teamId}
        onChange={setTeamId}
      />
      <Button
        variant="primary"
        size="sm"
        disabled={teamId === ''}
        onClick={() =>
          onCall('/api/integrations/github', 'POST', {
            repositoryId: repo.repositoryId,
            repositoryName: repo.repositoryName,
            installationId: repo.installationId,
            defaultBranch: repo.defaultBranch,
            teamId,
          })
        }
      >
        Link
      </Button>
    </span>
  );
}

function RepoMappingRow({
  repo,
  teams,
  canManage,
  onCall,
}: {
  repo: RepoRow;
  teams: readonly IntegrationTeam[];
  canManage: boolean;
  onCall: CallFn;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-dense text-text">{repo.repositoryName}</span>
        <span className="text-2xs text-faint">
          {repo.linked === null ? 'Not linked' : teamName(teams, repo.linked.teamId)}
        </span>
      </span>
      {canManage ? <RepoAction repo={repo} teams={teams} onCall={onCall} /> : null}
    </li>
  );
}

interface ChannelRow {
  readonly channelId: string;
  readonly channelName: string;
  readonly connected: ConnectedChannel | null;
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
  const connectedById = new Map(settings.channels.map((channel) => [channel.channelId, channel]));
  const availableIds = new Set(settings.availableChannels.map((channel) => channel.channelId));
  const rows: ChannelRow[] = [
    ...settings.availableChannels.map((channel) => ({
      channelId: channel.channelId,
      channelName: channel.channelName,
      connected: connectedById.get(channel.channelId) ?? null,
    })),
    ...settings.channels
      .filter((channel) => !availableIds.has(channel.channelId))
      .map((channel) => ({
        channelId: channel.channelId,
        channelName: channel.channelName,
        connected: channel,
      })),
  ];

  return (
    <IntegrationCard
      title="Slack"
      description="Add Orbit to your Slack workspace, then map a channel to a team. Orbit unfurls issue links and posts pull request updates. One channel per team, one team per channel."
      status={<ConnectionBadge connected={settings.slackHasToken} />}
    >
      {settings.slackHasToken ? (
        <div className="flex flex-col gap-2.5">
          <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
            {rows.length === 0 ? (
              <li className="px-3 py-2.5 text-faint text-xs">
                {settings.slackChannelsError
                  ? 'Could not load channels from Slack. Try again shortly.'
                  : 'No channels are visible to Orbit yet. Invite Orbit to a channel in Slack.'}
              </li>
            ) : (
              rows.map((channel) => (
                <ChannelMappingRow
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
            <ConnectLink
              href="/api/integrations/slack/start"
              label="Reconnect Slack"
              variant="secondary"
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

function ChannelAction({
  channel,
  teams,
  onCall,
}: {
  channel: ChannelRow;
  teams: readonly IntegrationTeam[];
  onCall: CallFn;
}) {
  const [teamId, setTeamId] = useState('');

  if (channel.connected !== null) {
    return (
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
    );
  }

  return (
    <span className="flex items-center gap-2">
      <TeamSelect
        id={`slack-team-${channel.channelId}`}
        teams={teams}
        value={teamId}
        onChange={setTeamId}
        allowWorkspace
      />
      <Button
        variant="primary"
        size="sm"
        onClick={() =>
          onCall('/api/integrations/slack', 'POST', {
            action: 'connect',
            channelId: channel.channelId,
            channelName: channel.channelName,
            teamId: teamId === '' ? null : teamId,
          })
        }
      >
        Connect
      </Button>
    </span>
  );
}

function ChannelMappingRow({
  channel,
  teams,
  canManage,
  onCall,
}: {
  channel: ChannelRow;
  teams: readonly IntegrationTeam[];
  canManage: boolean;
  onCall: CallFn;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-dense text-text">#{channel.channelName}</span>
        <span className="text-2xs text-faint">
          {channel.connected === null ? 'Not connected' : teamName(teams, channel.connected.teamId)}
        </span>
      </span>
      {canManage ? <ChannelAction channel={channel} teams={teams} onCall={onCall} /> : null}
    </li>
  );
}

function McpSection({ mcpUrl, onError }: { mcpUrl: string; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError('Could not copy the MCP URL. Select and copy it manually.');
    }
  }

  return (
    <IntegrationCard
      title="MCP server"
      description="Connect an MCP-aware AI client to Orbit. The server exposes read and write tools for issues and acts as whoever owns the API key you authenticate with."
      status={<Badge tone="accent">Streamable HTTP</Badge>}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-faint">Server URL</span>
        <div className="flex items-center gap-2">
          <code
            data-testid="mcp-url"
            className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-dense text-text"
          >
            {mcpUrl}
          </code>
          <Button variant="secondary" onClick={copy} aria-label="Copy MCP server URL">
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <ol className="flex flex-col gap-1 text-muted text-xs">
        <li>Add the server URL above to your AI client as a streamable HTTP MCP server.</li>
        <li>
          Authenticate with an Orbit API key sent as a bearer token. Keys are issued by an admin.
        </li>
        <li>Ask the client to call get_me to confirm the connection.</li>
      </ol>
    </IntegrationCard>
  );
}
