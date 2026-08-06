'use client';

import { Users, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { IssuePeek } from '@/features/issues/issue-peek.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { StandupWorkload } from '@/lib/query/schemas.ts';
import { useStandupBoard } from '@/lib/query/use-standup-board.ts';
import type { PersonColumn } from './buckets.ts';
import { NO_ISSUES, personColumns } from './buckets.ts';
import { PersonColumns } from './person-columns.tsx';
import { formatBoardDate, formatSinceLabel, standupSince } from './standup-clock.ts';
import { BoardSkeleton } from './standup-skeleton.tsx';
import { StandupTimer } from './standup-timer.tsx';

const NO_WORKLOAD: readonly StandupWorkload[] = [];

export function StandupBoard() {
  const workspace = useWorkspace();
  const [openedAt] = useState(() => new Date());
  const [since] = useState(() => standupSince(new Date()));
  const board = useStandupBoard(since);

  const [peekId, setPeekId] = useState<string | null>(null);
  const [timerOn, setTimerOn] = useState(false);

  const issues = board.data?.issues ?? NO_ISSUES;
  const workload = board.data?.workload ?? NO_WORKLOAD;
  const columns = useMemo(
    () => personColumns(issues, workspace.members, workload, workspace.stateById),
    [issues, workload, workspace.members, workspace.stateById],
  );

  useHotkey('t', () => setTimerOn((on) => !on), {
    label: 'Toggle standup timer',
    section: 'Standup',
    scope: 'standup',
    enabled: peekId === null,
  });

  const sinceLabel = useMemo(() => formatSinceLabel(since, openedAt), [since, openedAt]);
  const peeked = issues.find((issue) => issue.id === peekId);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="standup-board">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-border border-b px-4 py-2.5">
        <h1 className="font-medium text-dense text-text">Standup</h1>
        <span data-numeric className="text-2xs text-faint">
          {formatBoardDate(openedAt)}
        </span>
        <span className="text-2xs text-faint" data-testid="standup-window">
          closed work {sinceLabel}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {timerOn ? <StandupTimer startedAt={openedAt.getTime()} /> : null}
          <Button
            size="sm"
            variant="ghost"
            data-testid="toggle-standup-timer"
            onClick={() => setTimerOn((on) => !on)}
          >
            {timerOn ? 'Hide timer' : 'Timer'}
          </Button>
        </div>
      </header>

      <BoardBody
        loading={!workspace.ready || board.isPending}
        failed={board.isError}
        columns={columns}
        onPeek={setPeekId}
        onRetry={() => {
          board.refetch().catch(() => undefined);
        }}
      />

      <IssuePeek issue={peeked} onClose={() => setPeekId(null)} />
    </div>
  );
}

interface BoardBodyProps {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly columns: readonly PersonColumn[];
  readonly onPeek: (issueId: string) => void;
  readonly onRetry: () => void;
}

function BoardBody({ loading, failed, columns, onPeek, onRetry }: BoardBodyProps) {
  if (loading) return <BoardSkeleton />;

  if (failed) {
    return (
      <EmptyState
        icon={<WifiOff strokeWidth={1.75} aria-hidden="true" />}
        title="Could not load the board"
        description="The board reads every open issue in this workspace in one request. Try again."
        className="flex-1"
        action={
          <Button size="sm" variant="secondary" data-testid="retry-standup" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  if (columns.length === 0) {
    return (
      <EmptyState
        icon={<Users strokeWidth={1.75} aria-hidden="true" />}
        title="Nobody has work on the board"
        description="Assign an issue and its owner gets a column here with everything they are carrying."
        className="flex-1"
      />
    );
  }

  return <PersonColumns columns={columns} onOpen={onPeek} />;
}
