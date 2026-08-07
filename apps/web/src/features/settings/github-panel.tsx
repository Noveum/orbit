'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { rowHover } from '@/lib/interaction.ts';
import type {
  GithubInstallationSummary,
  GithubProjectOption,
  GithubRepositoryEntry,
  GithubSettingsView,
} from './github-view.ts';

const WORKSPACE_OPTION = '__workspace__';

export interface GithubPanelProps {
  readonly settings: GithubSettingsView;
  readonly canManage: boolean;
  readonly onError: (message: string | null) => void;
}

type Busy = string | null;

export function GithubPanel({ settings, canManage, onError }: GithubPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [search, setSearch] = useState('');

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    onError(null);
    setBusy(key);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      onError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return settings.repositories;
    return settings.repositories.filter((repository) =>
      repository.fullName.toLowerCase().includes(needle),
    );
  }, [settings.repositories, search]);

  const grouped = useMemo(() => groupByAccount(filtered), [filtered]);

  if (!settings.connected) {
    return <NotConnected canManage={canManage} connectEnabled={settings.connectEnabled} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <InstallationList
        installations={settings.installations}
        canManage={canManage}
        busy={busy}
        onRemove={(installationId) =>
          run(`installation:${installationId}`, () =>
            apiRequest(
              `/api/integrations/github/installations?installationId=${encodeURIComponent(installationId)}`,
              { method: 'DELETE' },
            ),
          )
        }
      />

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href="/api/integrations/github/start">Connect another organisation</a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy === 'refresh'}
            onClick={() =>
              run('refresh', () =>
                apiRequest('/api/integrations/github/repositories', { method: 'POST' }),
              )
            }
          >
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh from GitHub'}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Input
          value={search}
          placeholder="Search repositories…"
          aria-label="Search repositories"
          onChange={(event) => setSearch(event.target.value)}
        />
        {grouped.length === 0 ? (
          <p className="rounded-lg border border-border border-dashed px-3 py-4 text-center text-faint text-xs">
            No repositories match. Add repositories to the installation on GitHub, then refresh.
          </p>
        ) : (
          grouped.map((group) => (
            <RepositoryGroup
              key={group.accountLogin}
              accountLogin={group.accountLogin}
              repositories={group.repositories}
              projects={settings.projects}
              canManage={canManage}
              busy={busy}
              onRun={run}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NotConnected({
  canManage,
  connectEnabled,
}: {
  canManage: boolean;
  connectEnabled: boolean;
}) {
  if (!canManage) {
    return <p className="text-muted text-xs">Ask a workspace admin to connect GitHub.</p>;
  }
  if (!connectEnabled) {
    return (
      <p className="rounded-lg border border-border border-dashed bg-surface-2 px-3 py-2 text-faint text-2xs">
        Ask a workspace admin to finish configuring the GitHub App before connecting.
      </p>
    );
  }
  return (
    <Button asChild variant="primary" className="w-fit">
      <a href="/api/integrations/github/start">Connect GitHub</a>
    </Button>
  );
}

function selectionLabel(installation: GithubInstallationSummary): string {
  if (installation.repositorySelection === 'all') return 'All repositories';
  return `${installation.repositoryCount} selected`;
}

function InstallationList({
  installations,
  canManage,
  busy,
  onRemove,
}: {
  installations: readonly GithubInstallationSummary[];
  canManage: boolean;
  busy: Busy;
  onRemove: (installationId: string) => void;
}) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
      {installations.map((installation) => (
        <li
          key={installation.installationId}
          className={`flex items-center justify-between gap-3 border-border border-b px-3 py-2.5 last:border-b-0 ${rowHover}`}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-dense text-text">
                {installation.accountLogin}
              </span>
              {installation.status === 'suspended' ? (
                <Badge tone="warning">Suspended</Badge>
              ) : (
                <Badge tone="success">Active</Badge>
              )}
            </span>
            <span className="text-2xs text-faint">
              {installation.accountType} · {selectionLabel(installation)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <a href={installation.manageUrl} target="_blank" rel="noreferrer">
                Manage on GitHub
              </a>
            </Button>
            {canManage ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === `installation:${installation.installationId}`}
                aria-label={`Remove the ${installation.accountLogin} installation`}
                onClick={() => onRemove(installation.installationId)}
              >
                Remove
              </Button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface AccountGroup {
  readonly accountLogin: string;
  readonly repositories: GithubRepositoryEntry[];
}

function groupByAccount(repositories: readonly GithubRepositoryEntry[]): AccountGroup[] {
  const byAccount = new Map<string, GithubRepositoryEntry[]>();
  for (const repository of repositories) {
    const bucket = byAccount.get(repository.accountLogin) ?? [];
    bucket.push(repository);
    byAccount.set(repository.accountLogin, bucket);
  }
  return [...byAccount.entries()].map(([accountLogin, entries]) => ({
    accountLogin,
    repositories: entries,
  }));
}

type RunFn = (key: string, action: () => Promise<unknown>) => Promise<void>;

function RepositoryGroup({
  accountLogin,
  repositories,
  projects,
  canManage,
  busy,
  onRun,
}: {
  accountLogin: string;
  repositories: readonly GithubRepositoryEntry[];
  projects: readonly GithubProjectOption[];
  canManage: boolean;
  busy: Busy;
  onRun: RunFn;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="px-1 font-medium text-2xs text-faint uppercase tracking-wide">
        {accountLogin}
      </h4>
      <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
        {repositories.map((repository) => (
          <RepositoryRow
            key={repository.id}
            repository={repository}
            projects={projects}
            canManage={canManage}
            busy={busy}
            onRun={onRun}
          />
        ))}
      </ul>
    </section>
  );
}

function RepositoryRow({
  repository,
  projects,
  canManage,
  busy,
  onRun,
}: {
  repository: GithubRepositoryEntry;
  projects: readonly GithubProjectOption[];
  canManage: boolean;
  busy: Busy;
  onRun: RunFn;
}) {
  const [choice, setChoice] = useState(WORKSPACE_OPTION);
  const linkedProjectIds = new Set(
    repository.links.map((link) => link.projectId ?? WORKSPACE_OPTION),
  );
  const busyKey = `repo:${repository.repositoryId}`;

  const link = () =>
    onRun(busyKey, () =>
      apiRequest('/api/integrations/github', {
        method: 'POST',
        body: {
          repositoryId: repository.repositoryId,
          projectId: choice === WORKSPACE_OPTION ? null : choice,
        },
      }),
    );

  const unlink = (projectId: string | null) =>
    onRun(busyKey, () =>
      apiRequest(
        `/api/integrations/github?repositoryId=${encodeURIComponent(repository.repositoryId)}${
          projectId === null ? '' : `&projectId=${encodeURIComponent(projectId)}`
        }`,
        { method: 'DELETE' },
      ),
    );

  return (
    <li
      className={`flex flex-col gap-2 border-border border-b px-3 py-2.5 last:border-b-0 ${rowHover}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-dense text-text underline-offset-2 hover:underline"
            >
              {repository.fullName}
            </a>
            {repository.private ? <Badge tone="neutral">Private</Badge> : null}
            {repository.archived ? <Badge tone="outline">Archived</Badge> : null}
          </span>
          <LinkChips
            repository={repository}
            canManage={canManage}
            busy={busy === busyKey}
            onRemove={unlink}
          />
        </span>
        {canManage ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <select
              aria-label={`Associate ${repository.fullName} with`}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-dense text-text"
            >
              <option value={WORKSPACE_OPTION}>Workspace</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy === busyKey || linkedProjectIds.has(choice)}
              onClick={link}
            >
              {linkedProjectIds.has(choice) ? 'Added' : 'Add'}
            </Button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

function LinkChips({
  repository,
  canManage,
  busy,
  onRemove,
}: {
  repository: GithubRepositoryEntry;
  canManage: boolean;
  busy: boolean;
  onRemove: (projectId: string | null) => void;
}) {
  if (repository.links.length === 0) {
    return <span className="text-2xs text-faint">Not associated yet</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {repository.links.map((entry) => (
        <span
          key={entry.id}
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 py-0.5 pr-0.5 pl-1.5 text-2xs text-muted"
        >
          {entry.projectId === null ? 'Workspace' : (entry.projectName ?? 'Unknown project')}
          {canManage ? (
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove ${
                entry.projectId === null ? 'the workspace association' : (entry.projectName ?? '')
              } from ${repository.fullName}`}
              onClick={() => onRemove(entry.projectId)}
              className="rounded-[3px] px-1 text-faint transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-hover hover:text-text disabled:cursor-not-allowed"
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </span>
  );
}
