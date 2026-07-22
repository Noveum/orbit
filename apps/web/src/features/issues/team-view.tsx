'use client';

import { Columns3, List } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { useIssues } from '@/lib/query/use-issues.ts';
import { Board } from './board.tsx';
import { IssueList } from './issue-list.tsx';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

export interface TeamViewProps {
  readonly teamKey: string;
  readonly layout: 'board' | 'list';
}

export function TeamView({ teamKey, layout }: TeamViewProps) {
  const router = useRouter();
  const workspace = useWorkspace();
  const team = workspace.teams.find((entry) => entry.key.toLowerCase() === teamKey.toLowerCase());
  const teamId = team?.id ?? null;

  const seed = workspace.seedIssues.filter((issue) => issue.teamId === teamId);
  const issues = useIssues(teamId, seed.length === 0 ? undefined : seed);

  const other = layout === 'board' ? 'issues' : 'board';
  useHotkey(
    'mod+b',
    () => {
      router.push(`/team/${teamKey.toLowerCase()}/${other}`);
    },
    { label: 'Toggle board and list', section: 'View' },
  );

  if (!workspace.ready) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  if (team === null || teamId === null) {
    return (
      <EmptyState
        icon={<List strokeWidth={1.75} aria-hidden="true" />}
        title="No such team"
        description={`Nothing here matches "${teamKey}".`}
      />
    );
  }

  const states = statesForTeam(workspace.states, teamId);
  const rows = issues.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">{team?.name ?? teamKey}</h1>
        <span data-numeric className="text-2xs text-faint">
          {rows.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ViewToggle teamKey={teamKey} layout={layout} />
          <Button
            size="sm"
            variant="primary"
            onClick={() => workspace.openQuickCreate(teamId)}
            data-testid="new-issue"
          >
            New issue
          </Button>
        </div>
      </div>

      <TeamContent
        teamId={teamId}
        states={states}
        issues={rows}
        layout={layout}
        loading={issues.isPending || issues.isFetching}
      />
    </div>
  );
}

interface TeamContentProps {
  readonly teamId: string;
  readonly states: readonly WorkflowState[];
  readonly issues: readonly Issue[];
  readonly layout: 'board' | 'list';
  readonly loading: boolean;
}

function TeamContent({ teamId, states, issues, layout, loading }: TeamContentProps) {
  if (issues.length === 0 && !loading) {
    return (
      <EmptyState
        icon={<Columns3 strokeWidth={1.75} aria-hidden="true" />}
        title="No issues yet"
        description="Press C to create the first one."
        className="flex-1"
      />
    );
  }
  if (layout === 'board') return <Board teamId={teamId} states={states} issues={issues} />;
  return <IssueList teamId={teamId} states={states} issues={issues} />;
}

function ViewToggle({ teamKey, layout }: { teamKey: string; layout: 'board' | 'list' }) {
  const base = `/team/${teamKey.toLowerCase()}`;
  const itemClass =
    'flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs transition-colors duration-[var(--duration-fast)]';

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      <Link
        href={`${base}/issues`}
        data-testid="view-list"
        className={cn(itemClass, layout === 'list' ? 'bg-surface-2 text-text' : 'text-faint')}
      >
        <List className="size-3.5" aria-hidden="true" />
        List
      </Link>
      <Link
        href={`${base}/board`}
        data-testid="view-board"
        className={cn(itemClass, layout === 'board' ? 'bg-surface-2 text-text' : 'text-faint')}
      >
        <Columns3 className="size-3.5" aria-hidden="true" />
        Board
      </Link>
    </div>
  );
}
