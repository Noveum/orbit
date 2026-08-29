'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  GitPullRequest,
  MessageSquareText,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { IssueLink } from '@/features/issues/issue-link.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover, tabHover } from '@/lib/interaction.ts';
import type { GithubReach, PullRequestRow } from './data.ts';
import { PR_GROUP_ORDER, prStateLabel, prStateTone } from './pr-state.ts';
import { usePullRefresh } from './use-pull-refresh.ts';

export interface PullsViewProps {
  readonly pulls: readonly PullRequestRow[];
  readonly total?: number;
  readonly userId: string;
  readonly reach: GithubReach;
  readonly canManageIntegrations: boolean;
  readonly currentPage?: number;
  readonly hasMore?: boolean;
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
    admin: 'Connect GitHub and pick the repositories whose pull requests Orbit should mirror.',
    member: 'A workspace admin needs to connect GitHub before pull requests can appear here.',
    action: 'Connect GitHub',
  },
  suspended: {
    title: 'The GitHub installation is suspended',
    admin:
      'GitHub is refusing to send anything while the installation is suspended. Lift it in the GitHub App settings, then refresh the connection.',
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
    title: 'No pull requests in tracked repositories',
    admin:
      'GitHub can see additional repositories this workspace has not switched on. Track the repositories whose pull requests should appear here, then refresh to import their open pull requests.',
    member:
      'GitHub can see additional repositories this workspace has not switched on. A workspace admin chooses which repositories Orbit mirrors.',
    action: 'Check tracked repositories',
  },
  connected: {
    title: 'No pull requests have synced yet',
    admin:
      'Orbit mirrors pull requests from tracked repositories. Refresh GitHub repositories if this workspace was connected before PR mirroring was enabled.',
    member:
      'Orbit mirrors pull requests from tracked repositories. A workspace admin can refresh the GitHub connection if this stays empty.',
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

export function PullsView({
  pulls,
  total = pulls.length,
  userId,
  reach,
  canManageIntegrations,
  currentPage = 1,
  hasMore = false,
}: PullsViewProps) {
  const router = useRouter();
  usePullRefresh();
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
    <div className="flex min-h-full flex-col bg-surface">
      <header className="flex items-center justify-between gap-3 border-border border-b px-5 py-3">
        <h1 className="flex items-center gap-2 font-semibold text-lg text-text">
          Pull requests
          <Badge tone={total > 0 ? 'accent' : 'neutral'} data-testid="pulls-count">
            {total}
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
              <ul className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
                {group.rows.map((pull) => (
                  <li key={pull.id}>
                    <div
                      className={cn(
                        'flex items-center gap-3 border-border border-b px-3 py-2.5 last:border-b-0',
                        rowHover,
                      )}
                    >
                      <GitPullRequest className="size-4 shrink-0 text-faint" aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Link
                          href={`/pulls/${pull.id}`}
                          className={cn('truncate rounded-sm text-dense text-text', tabHover)}
                        >
                          {pull.title}
                        </Link>
                        <span className="flex flex-wrap items-center gap-1.5 text-2xs text-faint">
                          <span className="font-mono">
                            {pull.repository}#{pull.number ?? '?'}
                          </span>
                          {pull.authorLogin.length > 0 ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{pull.authorLogin}</span>
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <MessageSquareText className="size-3" aria-hidden="true" />
                            {pull.activityCount}
                          </span>
                        </span>
                        {pull.linkedIssues.length > 0 ? (
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-faint">
                            {pull.linkedIssues.map((linked) => (
                              <span
                                key={linked.identifier}
                                className="inline-flex items-center gap-1.5"
                              >
                                <IssueLink
                                  identifier={linked.identifier}
                                  testId={`pull-issue-${linked.identifier}`}
                                  className={cn(
                                    'flex min-w-0 items-center gap-1 rounded-sm',
                                    tabHover,
                                  )}
                                >
                                  <span className="shrink-0">{linked.identifier}</span>
                                  <span className="max-w-56 truncate">{linked.title}</span>
                                </IssueLink>
                                {linked.project === null ? null : (
                                  <Link
                                    href={`/projects/${linked.project.slug}`}
                                    className="rounded-sm text-accent underline-offset-2 hover:underline"
                                  >
                                    {linked.project.name}
                                  </Link>
                                )}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-2xs text-faint">No Orbit task linked</span>
                        )}
                      </div>
                      <span className="hidden shrink-0 text-2xs text-faint sm:block">
                        <RelativeTime at={pull.updatedAt} />
                      </span>
                      {pull.checkStatus === 'success' ? (
                        <CircleCheck
                          className="size-4 shrink-0 text-success"
                          aria-label="Checks passing"
                        />
                      ) : null}
                      {pull.checkStatus === 'failure' ? (
                        <CircleX
                          className="size-4 shrink-0 text-danger"
                          aria-label="Checks failing"
                        />
                      ) : null}
                      <Badge tone={prStateTone(pull.state)}>{prStateLabel(pull.state)}</Badge>
                      <a
                        href={pull.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open on GitHub"
                        className={cn('rounded-sm p-1 text-faint', rowHover, tabHover)}
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {currentPage > 1 || hasMore ? (
            <nav aria-label="Pull request pages" className="flex items-center justify-end gap-2">
              {currentPage > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={currentPage === 2 ? '/pulls' : `/pulls?page=${currentPage - 1}`}>
                    Previous
                  </Link>
                </Button>
              ) : null}
              {hasMore ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/pulls?page=${currentPage + 1}`}>Next</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
