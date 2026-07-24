'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import { GitPullRequest } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { apiRequest } from '@/lib/api/client.ts';
import { prStateLabel, prStateTone } from './pr-state.ts';

interface IssuePull {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly repository: string;
  readonly number: number | null;
  readonly state: string;
}

interface GitLinksResponse {
  readonly pulls: IssuePull[];
}

export function IssuePullRequests({ issueId }: { readonly issueId: string }) {
  const [pulls, setPulls] = useState<readonly IssuePull[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<GitLinksResponse>(
        `/api/integrations/git-links?issueId=${encodeURIComponent(issueId)}`,
        { method: 'GET' },
      );
      setPulls(data.pulls);
    } catch {
      setPulls([]);
    }
  }, [issueId]);

  useEffect(() => {
    load();
  }, [load]);

  useScopeSubscription([scopes.issue(issueId)]);
  useDeltaHandler(
    useCallback(
      (actions) => {
        if (actions.some((action) => action.model === 'git_link')) load();
      },
      [load],
    ),
  );

  if (pulls.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-dense text-text">Pull requests</h3>
      <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
        {pulls.map((pull) => (
          <li
            key={pull.id}
            className="flex items-center gap-2.5 border-border border-b px-3 py-2 last:border-b-0"
          >
            <GitPullRequest className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
            <a
              href={pull.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 flex-1 flex-col rounded-sm hover:text-accent"
            >
              <span className="truncate text-dense text-text">{pull.title}</span>
              <span className="truncate font-mono text-2xs text-faint">
                {pull.repository}#{pull.number ?? '?'}
              </span>
            </a>
            <Badge tone={prStateTone(pull.state)}>{prStateLabel(pull.state)}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
