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

export function PullsEmptyState({
  reach,
  canManageIntegrations,
}: {
  readonly reach: GithubReach;
  readonly canManageIntegrations: boolean;
}) {
  const icon = <GitPullRequest strokeWidth={1.75} aria-hidden="true" />;
  const settingsAction = (label: string) =>
    canManageIntegrations ? (
      <Button asChild variant="primary">
        <Link href="/settings/integrations" data-testid="pulls-connect-github">
          {label}
        </Link>
      </Button>
    ) : undefined;

  if (reach === 'not_installed') {
    return (
      <EmptyState
        icon={icon}
        title="GitHub is not connected yet"
        description={
          canManageIntegrations
            ? 'Connect GitHub, pick the repositories to track, and pull requests naming an issue show up here.'
            : 'A workspace admin needs to connect GitHub before pull requests can appear here.'
        }
        {...(settingsAction('Connect GitHub') === undefined
          ? {}
          : { action: settingsAction('Connect GitHub') })}
        className="flex-1"
      />
    );
  }

  if (reach === 'suspended') {
    return (
      <EmptyState
        icon={icon}
        title="The GitHub installation is suspended"
        description={
          canManageIntegrations
            ? 'GitHub is refusing to send anything while the installation is suspended. Lift it in the GitHub App settings, then pull requests naming an issue show up here.'
            : 'GitHub is refusing to send anything while the installation is suspended. A workspace admin has to lift it on GitHub.'
        }
        {...(settingsAction('Open integrations') === undefined
          ? {}
          : { action: settingsAction('Open integrations') })}
        className="flex-1"
      />
    );
  }

  if (reach === 'no_repositories') {
    return (
      <EmptyState
        icon={icon}
        title="No repository is being tracked"
        description={
          canManageIntegrations
            ? 'GitHub is connected but no repository is switched on yet. Pick the ones this workspace should track.'
            : 'GitHub is connected but no repository is switched on yet. A workspace admin picks which ones to track.'
        }
        {...(settingsAction('Pick repositories') === undefined
          ? {}
          : { action: settingsAction('Pick repositories') })}
        className="flex-1"
      />
    );
  }

  return (
    <EmptyState
      icon={icon}
      title="No pull requests linked to your issues"
      description="Orbit links a pull request when its branch or title names an issue, like ENG-42. Copy branch name on an issue gives you one that matches."
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
