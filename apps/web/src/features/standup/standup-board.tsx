'use client';

import { Users, WifiOff } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { IssuePeek } from '@/features/issues/issue-peek.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { Member, StandupWorkload } from '@/lib/query/schemas.ts';
import { useStandupBoard } from '@/lib/query/use-standup-board.ts';
import type { PersonBuckets } from './buckets.ts';
import { bucketIssues, groupByAssignee, NO_ISSUES } from './buckets.ts';
import { PersonTiles } from './person-tiles.tsx';
import { PersonWork } from './person-work.tsx';
import { formatBoardDate, formatSinceLabel, standupSince } from './standup-clock.ts';
import { BoardSkeleton } from './standup-skeleton.tsx';
import { StandupTimer } from './standup-timer.tsx';

function byName(people: readonly Member[]): Member[] {
  return [...people].sort((left, right) => left.name.localeCompare(right.name));
}

export function StandupBoard() {
  const workspace = useWorkspace();
  const [openedAt] = useState(() => new Date());
  const [since] = useState(() => standupSince(new Date()));
  const board = useStandupBoard(since);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [timerOn, setTimerOn] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now());

  const people = useMemo(() => byName(workspace.members), [workspace.members]);
  const issues = board.data?.issues ?? NO_ISSUES;
  const issuesByUser = useMemo(() => groupByAssignee(issues), [issues]);
  const countById = useMemo(
    () => new Map([...issuesByUser].map(([userId, owned]) => [userId, owned.length])),
    [issuesByUser],
  );
  const workloadById = useMemo(
    () => new Map((board.data?.workload ?? []).map((row) => [row.userId, row])),
    [board.data],
  );

  const stillPresent = selectedId !== null && people.some((person) => person.id === selectedId);
  const activeId = (stillPresent ? selectedId : people[0]?.id) ?? null;
  const activeIndex = people.findIndex((person) => person.id === activeId);

  const selectPerson = useCallback((id: string) => {
    setSelectedId(id);
    setTurnStartedAt(Date.now());
  }, []);

  const move = useCallback(
    (step: number) => {
      if (people.length === 0) return;
      setTurnStartedAt(Date.now());
      setSelectedId((current) => {
        const from = people.findIndex((person) => person.id === current);
        const base = from < 0 ? 0 : from;
        const next = Math.min(people.length - 1, Math.max(0, base + step));
        return people[next]?.id ?? current;
      });
    },
    [people],
  );

  useHotkey('right', () => move(1), {
    label: 'Next person',
    section: 'Standup',
    scope: 'standup',
    enabled: peekId === null,
  });
  useHotkey('left', () => move(-1), {
    label: 'Previous person',
    section: 'Standup',
    scope: 'standup',
    enabled: peekId === null,
  });
  useHotkey('t', () => setTimerOn((on) => !on), {
    label: 'Toggle standup timer',
    section: 'Standup',
    scope: 'standup',
    enabled: peekId === null,
  });

  const buckets = useMemo(
    () =>
      bucketIssues(
        activeId === null ? NO_ISSUES : (issuesByUser.get(activeId) ?? NO_ISSUES),
        workspace.stateById,
      ),
    [activeId, issuesByUser, workspace.stateById],
  );
  const sinceLabel = useMemo(() => formatSinceLabel(since, openedAt), [since, openedAt]);
  const peeked = issues.find((issue) => issue.id === peekId);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="standup-board">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-border border-b px-4 py-2.5">
        <h1 className="font-medium text-dense text-text">Standup</h1>
        <span data-numeric className="text-2xs text-faint">
          {formatBoardDate(openedAt)}
        </span>
        {people.length === 0 ? null : (
          <span data-numeric className="text-2xs text-faint" data-testid="standup-position">
            {activeIndex + 1} of {people.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {timerOn ? <StandupTimer startedAt={turnStartedAt} /> : null}
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
        people={people}
        activeId={activeId}
        countById={countById}
        workloadById={workloadById}
        onSelect={selectPerson}
        buckets={buckets}
        sinceLabel={sinceLabel}
        peekId={peekId}
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
  readonly people: readonly Member[];
  readonly activeId: string | null;
  readonly countById: ReadonlyMap<string, number>;
  readonly workloadById: ReadonlyMap<string, StandupWorkload>;
  readonly onSelect: (userId: string) => void;
  readonly buckets: PersonBuckets;
  readonly sinceLabel: string;
  readonly peekId: string | null;
  readonly onPeek: (issueId: string) => void;
  readonly onRetry: () => void;
}

function BoardBody({
  loading,
  failed,
  people,
  activeId,
  countById,
  workloadById,
  onSelect,
  buckets,
  sinceLabel,
  peekId,
  onPeek,
  onRetry,
}: BoardBodyProps) {
  const workspace = useWorkspace();

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

  if (people.length === 0) {
    return (
      <EmptyState
        icon={<Users strokeWidth={1.75} aria-hidden="true" />}
        title="Nobody in this workspace yet"
        description="Invite the team and everyone shows up here with the work they own."
        className="flex-1"
      />
    );
  }

  return (
    <>
      <PersonTiles
        people={people}
        activeId={activeId}
        workloadById={workloadById}
        countById={countById}
        onSelect={onSelect}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PersonWork
          member={activeId === null ? undefined : workspace.memberById.get(activeId)}
          buckets={buckets}
          workload={activeId === null ? undefined : workloadById.get(activeId)}
          sinceLabel={sinceLabel}
          peekId={peekId}
          onPeek={onPeek}
        />
      </div>
    </>
  );
}
