'use client';

import { CircleDot } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { applyDisplayFilters } from '@/features/filters/display-filter.ts';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import { useAssignedIssues } from '@/lib/query/use-issues.ts';
import { GroupGlyph } from './group-glyph.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { IssueRow } from './issue-row.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export function assignedTo(issues: readonly Issue[], userId: string | null): Issue[] {
  if (userId === null) return [];
  return sortIssues(issues.filter((issue) => issue.assigneeId === userId));
}

export function MyIssuesView() {
  const router = useRouter();
  const workspace = useWorkspace();
  const { config, setConfig } = useViewConfig(null, 'list', 'my_issues');
  useProvideViewControls('my_issues', 'list', config, setConfig);

  const assigned = useAssignedIssues(workspace.userId);
  const sentinel = useRef<HTMLDivElement>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

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

  const loading = assigned.isPending;
  const mine = assignedTo(assigned.data ?? [], workspace.userId);

  const shown = applyDisplayFilters(mine, config.display, workspace.stateById);

  const states = useMemo(
    () => [...workspace.states].sort((left, right) => left.position - right.position),
    [workspace.states],
  );

  const groups = groupIssues(
    shown.issues,
    config.groupBy,
    {
      states,
      members: workspace.members,
      projects: workspace.projects,
      cycles: workspace.cycles,
      labels: workspace.labels,
    },
    {
      showEmptyGroups: config.display.showEmptyGroups,
      ordering: config.orderBy,
      subGroupBy: config.subGroupBy,
    },
  );

  if (!workspace.ready) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">My issues</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {shown.issues.length}
        </span>
      </div>

      {shown.issues.length === 0 ? (
        <EmptyState
          icon={<CircleDot strokeWidth={1.75} aria-hidden="true" />}
          title={loading ? 'Loading your issues' : 'Nothing assigned to you'}
          description="Issues assigned to you across every team show up here. Press C to create one."
          className="flex-1"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="my-issues-list">
          {groups.map((group) => (
            <section key={group.id}>
              <div
                className="flex h-8 items-center gap-2 border-border border-b bg-surface-2/60 px-3"
                data-testid={`issue-group-${group.title}`}
              >
                <GroupGlyph group={group} />
                <h2 className="font-medium text-dense text-text">{group.title}</h2>
                <span data-numeric className="text-2xs text-faint">
                  {group.issues.length}
                </span>
              </div>
              {group.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  state={workspace.stateById.get(issue.stateId)}
                  properties={config.display.properties}
                  labels={issue.labelIds.flatMap((id) => {
                    const label = workspace.labelById.get(id);
                    return label === undefined ? [] : [label];
                  })}
                  assignee={
                    issue.assigneeId === null
                      ? undefined
                      : workspace.memberById.get(issue.assigneeId)
                  }
                  creator={workspace.memberById.get(issue.creatorId)}
                  active={peekId === issue.id}
                  selected={false}
                  onOpen={() => setPeekId(issue.id)}
                  onFocus={() => undefined}
                  onToggleSelected={() => undefined}
                />
              ))}
            </section>
          ))}
          {hasNextPage ? <div ref={sentinel} className="h-px" aria-hidden="true" /> : null}
        </div>
      )}

      <HiddenFooter
        hiddenByFilters={0}
        hiddenByDisplay={shown.hidden}
        onClearFilters={() => undefined}
        onRevealDisplay={() =>
          setConfig({
            ...config,
            display: { ...config.display, showSubIssues: true, showCompleted: 'all' },
          })
        }
      />

      <IssuePeek
        issue={mine.find((issue) => issue.id === peekId)}
        onClose={() => setPeekId(null)}
        onOpen={() => {
          const found = mine.find((issue) => issue.id === peekId);
          if (found !== undefined) router.push(`/issue/${found.identifier}`);
        }}
      />
    </div>
  );
}
