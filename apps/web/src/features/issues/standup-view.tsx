'use client';

import { dropLastCondition, isEmptyFilter } from '@orbit/shared/filters';
import { Columns3, LayoutList, List, Save, SearchX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { applyDisplayFilters } from '@/features/filters/display-filter.ts';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import { cn } from '@/lib/cn.ts';
import { tabHover } from '@/lib/interaction.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import { useAllIssues } from '@/lib/query/use-issues.ts';
import { Board } from './board.tsx';
import { GroupGlyph } from './group-glyph.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { IssueRow } from './issue-row.tsx';
import { useStandupPrefs } from './use-standup-prefs.ts';
import { useWorkspace } from './workspace-provider.tsx';

const MAX_BOARD_AUTOLOAD_PAGES = 10;

export function StandupView() {
  const router = useRouter();
  const workspace = useWorkspace();
  const prefs = useStandupPrefs(workspace.userId);
  const { config, layout, setConfig, setLayout, save, dirty } = prefs;
  const controls = useProvideViewControls('saved_view', layout, config);
  const filtered = !isEmptyFilter(config.filter);

  const all = useAllIssues({ filter: config.filter, orderBy: config.orderBy }, prefs.ready);
  const sentinel = useRef<HTMLDivElement>(null);
  const boardAutoLoads = useRef(0);
  const [peekId, setPeekId] = useState<string | null>(null);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = all;
  const searchKey = `${JSON.stringify(config.filter)}|${config.orderBy}|${layout}`;
  const prevSearchKey = useRef(searchKey);

  useEffect(() => {
    if (prevSearchKey.current !== searchKey) {
      prevSearchKey.current = searchKey;
      boardAutoLoads.current = 0;
    }
    if (layout === 'board') {
      if (hasNextPage && !isFetchingNextPage && boardAutoLoads.current < MAX_BOARD_AUTOLOAD_PAGES) {
        boardAutoLoads.current += 1;
        fetchNextPage().catch(() => undefined);
      }
      return;
    }
    const node = sentinel.current;
    if (node === null || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        fetchNextPage().catch(() => undefined);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [searchKey, layout, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const loading = all.isPending;
  const issues = useMemo(() => sortIssues(all.data ?? []), [all.data]);
  const shown = applyDisplayFilters(issues, config.display, workspace.stateById);

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

  if (!(workspace.ready && prefs.ready)) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  let body: ReactNode;
  if (shown.issues.length === 0 && filtered && !loading) {
    body = (
      <EmptyState
        icon={<SearchX strokeWidth={1.75} aria-hidden="true" />}
        title="No issues match these filters"
        description="Loosen a filter to widen the search."
        className="flex-1"
        action={
          <Button
            size="sm"
            data-testid="clear-last-filter"
            onClick={() => setConfig({ ...config, filter: dropLastCondition(config.filter) })}
          >
            Clear the last filter
          </Button>
        }
      />
    );
  } else if (shown.issues.length === 0) {
    body = (
      <EmptyState
        icon={<LayoutList strokeWidth={1.75} aria-hidden="true" />}
        title={loading ? 'Loading every project' : 'No issues yet'}
        description="Every issue across all teams and projects shows up here for standup. Press C to create one."
        className="flex-1"
      />
    );
  } else if (layout === 'board') {
    body = (
      <Board teamId="" groups={groups} draggable={false} properties={config.display.properties} />
    );
  } else {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="standup-list">
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
                  issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId)
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
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">Standup</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {shown.issues.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <StandupToggle layout={layout} onChange={setLayout} />
          <Button
            size="sm"
            variant="ghost"
            data-testid="save-standup"
            aria-label="Save Standup setup"
            disabled={!dirty}
            onClick={save}
          >
            <Save className="size-3.5" aria-hidden="true" />
            Save
          </Button>
        </div>
      </div>

      <FilterBar
        teamId={null}
        teamName="Standup"
        layout={layout}
        config={config}
        onChange={setConfig}
        controls={controls}
        issues={shown.issues}
        showSaveView={false}
      />

      {body}

      <HiddenFooter
        hiddenByFilters={0}
        hiddenByDisplay={shown.hidden}
        onClearFilters={() => setConfig({ ...config, filter: { ...config.filter, children: [] } })}
        onRevealDisplay={() =>
          setConfig({
            ...config,
            display: { ...config.display, showSubIssues: true, showCompleted: 'all' },
          })
        }
      />

      {layout === 'board' ? null : (
        <IssuePeek
          issue={issues.find((issue) => issue.id === peekId)}
          onClose={() => setPeekId(null)}
          onOpen={() => {
            const found = issues.find((issue) => issue.id === peekId);
            if (found !== undefined) router.push(`/issue/${found.identifier}`);
          }}
        />
      )}
    </div>
  );
}

function StandupToggle({
  layout,
  onChange,
}: {
  layout: ViewLayoutMode;
  onChange: (next: ViewLayoutMode) => void;
}) {
  const itemClass = cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs', tabHover);

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      <button
        type="button"
        data-testid="standup-list-toggle"
        onClick={() => onChange('list')}
        className={cn(itemClass, layout === 'list' ? 'bg-surface-2 text-text' : 'text-faint')}
      >
        <List className="size-3.5" aria-hidden="true" />
        List
      </button>
      <button
        type="button"
        data-testid="standup-board-toggle"
        onClick={() => onChange('board')}
        className={cn(itemClass, layout === 'board' ? 'bg-surface-2 text-text' : 'text-faint')}
      >
        <Columns3 className="size-3.5" aria-hidden="true" />
        Board
      </button>
    </div>
  );
}
