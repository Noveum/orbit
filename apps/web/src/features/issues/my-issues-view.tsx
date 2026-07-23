'use client';

import { CircleDot } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import { useAssignedIssues } from '@/lib/query/use-issues.ts';
import { IssueRow } from './issue-row.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export function assignedTo(issues: readonly Issue[], userId: string | null): Issue[] {
  if (userId === null) return [];
  return sortIssues(issues.filter((issue) => issue.assigneeId === userId));
}

export function MyIssuesView() {
  const router = useRouter();
  const workspace = useWorkspace();
  const assigned = useAssignedIssues(workspace.userId);
  const sentinel = useRef<HTMLDivElement>(null);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = assigned;
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        fetchNextPage().catch(() => undefined);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!workspace.ready) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  const loading = assigned.isPending;
  const mine = assignedTo(assigned.data ?? [], workspace.userId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">My issues</h1>
        <span data-numeric className="text-2xs text-faint">
          {mine.length}
        </span>
      </div>

      {mine.length === 0 ? (
        <EmptyState
          icon={<CircleDot strokeWidth={1.75} aria-hidden="true" />}
          title={loading ? 'Loading your issues' : 'Nothing assigned to you'}
          description="Issues assigned to you across every team show up here. Press C to create one."
          className="flex-1"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="my-issues-list">
          {mine.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              state={workspace.stateById.get(issue.stateId)}
              labels={issue.labelIds.flatMap((id) => {
                const label = workspace.labelById.get(id);
                return label === undefined ? [] : [label];
              })}
              assignee={
                issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId)
              }
              active={false}
              selected={false}
              onOpen={() => router.push(`/issue/${issue.identifier}`)}
              onFocus={() => undefined}
              onToggleSelected={() => undefined}
            />
          ))}
          {hasNextPage ? <div ref={sentinel} className="h-px" aria-hidden="true" /> : null}
        </div>
      )}
    </div>
  );
}
