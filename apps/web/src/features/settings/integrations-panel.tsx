'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import type { IntegrationSettings, IntegrationTeam } from './integrations-data.ts';

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

function GithubSection({
  settings,
  canManage,
  onCall,
}: {
  settings: IntegrationSettings;
  canManage: boolean;
  onCall: CallFn;
}) {
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [teamId, setTeamId] = useState(settings.teams[0]?.id ?? '');
  const canSubmit =
    repositoryName.trim().length > 0 && repositoryId.trim().length > 0 && teamId !== '';

  return (
    <IntegrationCard
      title="GitHub"
      description="Link a repository to a team. Orbit posts pull request updates on the matching issue and links issues from branch names and PR text such as ENG-42."
      status={<ConnectionBadge connected={settings.githubConnected} />}
    >
      <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
        {settings.repositories.length === 0 ? (
          <li className="px-3 py-2.5 text-faint text-xs">No repositories linked yet.</li>
        ) : (
          settings.repositories.map((repo) => (
            <li
              key={repo.id}
              className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-dense text-text">
                  {repo.repositoryName}
                </span>
                <span className="text-2xs text-faint">{teamName(settings.teams, repo.teamId)}</span>
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
          ))
        )}
      </ul>

      {canManage ? (
        <div className="flex flex-col gap-2.5">
          {settings.githubConnected ? null : (
            <p className="rounded-lg border border-border border-dashed bg-surface-2 px-3 py-2 text-faint text-2xs">
              Linking your first repository connects Orbit to GitHub. Point the repository webhook
              at /api/webhooks/github and share the value set in GITHUB_WEBHOOK_SECRET.
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              onCall('/api/integrations/github', 'POST', {
                repositoryId: repositoryId.trim(),
                repositoryName: repositoryName.trim(),
                teamId,
              });
              setRepositoryName('');
              setRepositoryId('');
            }}
          >
            <label htmlFor="gh-repo-name" className="flex flex-col gap-1 text-2xs text-faint">
              Repository
              <Input
                id="gh-repo-name"
                value={repositoryName}
                onChange={(event) => setRepositoryName(event.target.value)}
                className="h-8 w-56 text-xs"
                placeholder="acme/web"
              />
            </label>
            <label htmlFor="gh-repo-id" className="flex flex-col gap-1 text-2xs text-faint">
              Repository id
              <Input
                id="gh-repo-id"
                value={repositoryId}
                onChange={(event) => setRepositoryId(event.target.value)}
                className="h-8 w-32 text-xs"
                placeholder="123456"
              />
            </label>
            <label htmlFor="gh-team" className="flex flex-col gap-1 text-2xs text-faint">
              Team
              <select
                id="gh-team"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-dense text-text"
              >
                {settings.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary">
              {settings.githubConnected ? 'Link repository' : 'Connect GitHub'}
            </Button>
          </form>
        </div>
      ) : null}
    </IntegrationCard>
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
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [teamId, setTeamId] = useState('');

  return (
    <IntegrationCard
      title="Slack"
      description="Add Orbit to your Slack workspace, then map a channel to a team. Orbit unfurls issue links and posts pull request updates. One channel per team, one team per channel."
      status={<ConnectionBadge connected={settings.slackHasToken} />}
    >
      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (botToken.trim().length === 0) return;
            onCall('/api/integrations/slack', 'POST', {
              action: 'install',
              botToken: botToken.trim(),
            });
            setBotToken('');
          }}
        >
          <label htmlFor="slack-token" className="flex flex-col gap-1 text-2xs text-faint">
            Bot token
            <Input
              id="slack-token"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              className="h-8 w-72 text-xs"
              placeholder="xoxb-..."
              type="password"
            />
          </label>
          <Button type="submit" variant={settings.slackHasToken ? 'secondary' : 'primary'}>
            {settings.slackHasToken ? 'Update token' : 'Add to Slack'}
          </Button>
        </form>
      ) : null}

      <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
        {settings.channels.length === 0 ? (
          <li className="px-3 py-2.5 text-faint text-xs">No channels connected yet.</li>
        ) : (
          settings.channels.map((channel) => (
            <li
              key={channel.channelId}
              className="flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-dense text-text">#{channel.channelName}</span>
                <span className="text-2xs text-faint">
                  {teamName(settings.teams, channel.teamId)}
                </span>
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
          ))
        )}
      </ul>

      {canManage && settings.slackHasToken ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (channelId.trim().length === 0 || channelName.trim().length === 0) return;
            onCall('/api/integrations/slack', 'POST', {
              action: 'connect',
              channelId: channelId.trim(),
              channelName: channelName.trim(),
              teamId: teamId === '' ? null : teamId,
            });
            setChannelId('');
            setChannelName('');
          }}
        >
          <label htmlFor="slack-channel-id" className="flex flex-col gap-1 text-2xs text-faint">
            Channel id
            <Input
              id="slack-channel-id"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              className="h-8 w-32 text-xs"
              placeholder="C0123"
            />
          </label>
          <label htmlFor="slack-channel-name" className="flex flex-col gap-1 text-2xs text-faint">
            Channel name
            <Input
              id="slack-channel-name"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              className="h-8 w-40 text-xs"
              placeholder="engineering"
            />
          </label>
          <label htmlFor="slack-team" className="flex flex-col gap-1 text-2xs text-faint">
            Team
            <select
              id="slack-team"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-dense text-text"
            >
              <option value="">Workspace-wide</option>
              {settings.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary">
            Connect channel
          </Button>
        </form>
      ) : null}
    </IntegrationCard>
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
