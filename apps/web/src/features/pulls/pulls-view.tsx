'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import { relativeTime } from '@orbit/shared/utils';
import { GitPullRequest } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import type { PullRequestRow } from './data.ts';
import { PR_GROUP_ORDER, prStateLabel, prStateTone } from './pr-state.ts';

export interface PullsViewProps {
  readonly pulls: readonly PullRequestRow[];
  readonly userId: string;
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

export function PullsView({ pulls, userId }: PullsViewProps) {
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
        <EmptyState
          icon={<GitPullRequest strokeWidth={1.75} aria-hidden="true" />}
          title="No pull requests yet"
          description="Pull requests linked to your issues appear here with their review state."
          className="flex-1"
        />
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
                          <Link
                            href={`/issue/${pull.issueIdentifier}`}
                            className="hover:text-accent"
                          >
                            {pull.issueIdentifier}
                          </Link>
                          <span className="truncate">{pull.issueTitle}</span>
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
