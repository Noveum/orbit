'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
}

export function IntegrationsPanel({ settings, canManage }: IntegrationsPanelProps) {
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
    <div className="flex flex-col gap-8">
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <GithubSection settings={settings} canManage={canManage} onCall={call} />
      <SlackSection settings={settings} canManage={canManage} onCall={call} />
    </div>
  );
}

type CallFn = (path: string, method: string, body: Record<string, unknown>) => Promise<void>;

function GithubSection({
  settings,
  canManage,
  onCall,
}: {
  settings: IntegrationSettings;
  canManage: boolean;
  onCall: CallFn;
}) {
  const [repositoryId, setRepositoryId] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [teamId, setTeamId] = useState(settings.teams[0]?.id ?? '');

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-dense text-text">GitHub</h3>
        <span className="text-2xs text-faint">
          {settings.githubConnected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="text-muted text-xs">
        Link a repository to a team. Orbit receives verified webhooks, maps pull requests to issues
        by branch name, and moves issues as reviews land.
      </p>

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
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              repositoryId.trim().length === 0 ||
              repositoryName.trim().length === 0 ||
              teamId === ''
            ) {
              return;
            }
            onCall('/api/integrations/github', 'POST', {
              repositoryId: repositoryId.trim(),
              repositoryName: repositoryName.trim(),
              teamId,
            });
            setRepositoryId('');
            setRepositoryName('');
          }}
        >
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
          <label htmlFor="gh-repo-name" className="flex flex-col gap-1 text-2xs text-faint">
            Repository name
            <Input
              id="gh-repo-name"
              value={repositoryName}
              onChange={(event) => setRepositoryName(event.target.value)}
              className="h-8 w-56 text-xs"
              placeholder="acme/web"
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
            Link repository
          </Button>
        </form>
      ) : null}
    </section>
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
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-dense text-text">Slack</h3>
        <span className="text-2xs text-faint">
          {settings.slackHasToken ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="text-muted text-xs">
        Connect a workspace token, then map a channel to a team. Orbit unfurls issue links and posts
        pull request updates. One channel per team, one team per channel.
      </p>

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
          <Button type="submit" variant="secondary">
            Save token
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
    </section>
  );
}
