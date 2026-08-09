'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import { relativeTime } from '@orbit/shared/utils';
import { GitPullRequest } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { IssueLink } from '@/features/issues/issue-link.tsx';
import type { GithubReach, PullRequestRow } from './data.ts';
import { PR_GROUP_ORDER, prStateLabel, prStateTone } from './pr-state.ts';

export interface PullsViewProps {
  readonly pulls: readonly PullRequestRow[];
  readonly userId: string;
  readonly reach: GithubReach;
  readonly canManageIntegrations: boolean;
}

interface ReachCopy {
  readonly title: string;
  readonly admin: string;
  readonly member: string;
  readonly action: string;
}

const REACH_COPY: Record<GithubReach, ReachCopy> = {
  not_installed: {
    title: 'GitHub is not connected yet',
    admin:
      'Connect GitHub, pick the repositories to track, and pull requests naming an issue show up here.',
    member: 'A workspace admin needs to connect GitHub before pull requests can appear here.',
    action: 'Connect GitHub',
  },
  suspended: {
    title: 'The GitHub installation is suspended',
    admin:
      'GitHub is refusing to send anything while the installation is suspended. Lift it in the GitHub App settings, then pull requests naming an issue show up here.',
    member:
      'GitHub is refusing to send anything while the installation is suspended. A workspace admin has to lift it on GitHub.',
    action: 'Open integrations',
  },
  no_repositories: {
    title: 'No repository is being tracked',
    admin:
      'GitHub is connected but no repository is switched on yet. Pick the ones this workspace should track.',
    member:
      'GitHub is connected but no repository is switched on yet. A workspace admin picks which ones to track.',
    action: 'Pick repositories',
  },
  repositories_untracked: {
    title: 'No pull requests linked to your issues',
    admin:
      'Two things have to be true. The branch or title has to name an issue, like ENG-42, and the repository has to be tracked here. GitHub can see repositories this workspace has not switched on, and a pull request from one of those is dropped on arrival while GitHub still reports the delivery as accepted, so nothing looks wrong on either side.',
    member:
      'Two things have to be true. The branch or title has to name an issue, like ENG-42, and the repository has to be tracked here. GitHub can see repositories this workspace has not switched on, and pull requests from those are dropped on arrival. A workspace admin picks which ones to track.',
    action: 'Check tracked repositories',
  },
  connected: {
    title: 'No pull requests linked to your issues',
    admin:
      'Orbit links a pull request when its branch or title names an issue, like ENG-42. Copy branch name on an issue gives you one that matches.',
    member:
      'Orbit links a pull request when its branch or title names an issue, like ENG-42. Copy branch name on an issue gives you one that matches.',
    action: 'Open integrations',
  },
};

export function PullsEmptyState({
  reach,
  canManageIntegrations,
}: {
  readonly reach: GithubReach;
  readonly canManageIntegrations: boolean;
}) {
  const copy = REACH_COPY[reach];
  const action = canManageIntegrations ? (
    <Button asChild variant="primary">
      <Link href="/settings/integrations" data-testid="pulls-connect-github">
        {copy.action}
      </Link>
    </Button>
  ) : undefined;

  return (
    <EmptyState
      icon={<GitPullRequest strokeWidth={1.75} aria-hidden="true" />}
      title={copy.title}
      description={canManageIntegrations ? copy.admin : copy.member}
      {...(action === undefined ? {} : { action })}
      className="flex-1"
    />
  );
}

function groupPulls(pulls: readonly PullRequestRow[]): { state: string; rows: PullRequestRow[] }[] {
  const byState = new Map<string, PullRequestRow[]>();
  for (const pull of pulls) {
    byState.set(pull.state, [...(byState.get(pull.state) ?? []), pull]);
  }
  const ordered = [...byState.keys()].sort((a, b) => indexOfState(a) - indexOfState(b));
  return ordered.map((state) => ({ state, rows: byState.get(state) ?? [] }));
}

function indexOfState(state: string): number {
  const index = PR_GROUP_ORDER.indexOf(state);
  return index === -1 ? PR_GROUP_ORDER.length : index;
}

export function PullsView({ pulls, userId, reach, canManageIntegrations }: PullsViewProps) {
  const router = useRouter();
  useScopeSubscription([scopes.user(userId)]);
  useDeltaHandler(
    useCallback(
      (actions) => {
        if (
          actions.some((action) => action.model === 'notification' || action.model === 'git_link')
        ) {
          router.refresh();
        }
      },
      [router],
    ),
  );

  const groups = groupPulls(pulls);

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-border border-b px-5 py-3">
        <h1 className="flex items-center gap-2 font-semibold text-lg text-text">
          Pull requests
          <Badge tone={pulls.length > 0 ? 'accent' : 'neutral'} data-testid="pulls-count">
            {pulls.length}
          </Badge>
        </h1>
      </header>

      {pulls.length === 0 ? (
        <PullsEmptyState reach={reach} canManageIntegrations={canManageIntegrations} />
      ) : (
        <div className="flex flex-col gap-6 p-5">
          {groups.map((group) => (
            <section key={group.state} className="flex flex-col gap-1.5">
              <h2 className="flex items-center gap-2 px-1 text-2xs text-faint uppercase tracking-wide">
                {prStateLabel(group.state)}
                <span className="text-faint">{group.rows.length}</span>
              </h2>
              <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
                {group.rows.map((pull) => (
                  <li key={pull.id}>
                    <div className="flex items-center gap-3 border-border border-b px-3 py-2.5 last:border-b-0 hover:bg-surface-2">
                      <GitPullRequest className="size-4 shrink-0 text-faint" aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <a
                          href={pull.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate rounded-sm text-dense text-text hover:text-accent"
                        >
                          {pull.title}
                        </a>
                        <span className="flex items-center gap-1.5 truncate text-2xs text-faint">
                          <span className="font-mono">
                            {pull.repository}#{pull.number ?? '?'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <IssueLink
                            identifier={pull.issueIdentifier}
                            testId={`pull-issue-${pull.issueIdentifier}`}
                            className="flex min-w-0 items-center gap-1.5 rounded-sm hover:text-accent"
                          >
                            <span className="shrink-0">{pull.issueIdentifier}</span>
                            <span className="truncate">{pull.issueTitle}</span>
                          </IssueLink>
                        </span>
                      </div>
                      <span className="hidden shrink-0 text-2xs text-faint sm:block">
                        {relativeTime(new Date(pull.updatedAt))}
                      </span>
                      <Badge tone={prStateTone(pull.state)}>{prStateLabel(pull.state)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
