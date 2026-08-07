'use client';

import { ArrowRight, RotateCcw, Shuffle, Users, WifiOff } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { IssuePeek } from '@/features/issues/issue-peek.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { StandupWorkload } from '@/lib/query/schemas.ts';
import { useStandupBoard } from '@/lib/query/use-standup-board.ts';
import type { RosterEntry } from './buckets.ts';
import {
  NO_ISSUES,
  nextSpeaker,
  orderRoster,
  shuffle,
  stageGroups,
  standupRoster,
} from './buckets.ts';
import { PersonTiles } from './person-tiles.tsx';
import { StageColumns } from './stage-columns.tsx';
import { formatBoardDate, formatSinceLabel, standupSince } from './standup-clock.ts';
import { BoardSkeleton } from './standup-skeleton.tsx';
import { StandupTimer } from './standup-timer.tsx';

const NO_WORKLOAD: readonly StandupWorkload[] = [];
const NO_ORDER: readonly string[] = [];

export function StandupBoard() {
  const workspace = useWorkspace();
  const [openedAt] = useState(() => new Date());
  const [since] = useState(() => standupSince(new Date()));
  const board = useStandupBoard(since);

  const [peekId, setPeekId] = useState<string | null>(null);
  const [timerOn, setTimerOn] = useState(false);
  const [order, setOrder] = useState<readonly string[]>(NO_ORDER);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [spoken, setSpoken] = useState<ReadonlySet<string>>(() => new Set());

  const issues = board.data?.issues ?? NO_ISSUES;
  const workload = board.data?.workload ?? NO_WORKLOAD;

  const roster = useMemo(
    () =>
      orderRoster(standupRoster(issues, workspace.members, workload, workspace.stateById), order),
    [issues, workload, workspace.members, workspace.stateById, order],
  );

  const selected = useMemo(
    () => roster.find((entry) => entry.member.id === currentId) ?? roster[0],
    [roster, currentId],
  );

  const stages = useMemo(
    () => (selected === undefined ? [] : stageGroups(selected.issues, workspace.stateById)),
    [selected, workspace.stateById],
  );

  const activeId = selected?.member.id ?? null;

  const select = useCallback(
    (userId: string) => {
      if (activeId !== null && activeId !== userId) {
        setSpoken((done) => new Set(done).add(activeId));
      }
      setCurrentId(userId);
    },
    [activeId],
  );

  const goNext = useCallback(() => {
    const upcoming = nextSpeaker(roster, activeId, spoken);
    if (upcoming === null) {
      if (activeId !== null) setSpoken((done) => new Set(done).add(activeId));
      return;
    }
    select(upcoming);
  }, [roster, activeId, spoken, select]);

  const randomise = useCallback(() => {
    setOrder(shuffle(roster.map((entry) => entry.member.id)));
  }, [roster]);

  const reset = useCallback(() => {
    setSpoken(new Set());
    setCurrentId(null);
    setOrder(NO_ORDER);
  }, []);

  useHotkey('t', () => setTimerOn((on) => !on), {
    label: 'Toggle standup timer',
    section: 'Standup',
    scope: 'standup',
    enabled: peekId === null,
  });

  useHotkey('n', goNext, {
    label: 'Next speaker',
    section: 'Standup',
    scope: 'standup',
    enabled: peekId === null && roster.length > 0,
  });

  const sinceLabel = useMemo(() => formatSinceLabel(since, openedAt), [since, openedAt]);
  const peeked = issues.find((issue) => issue.id === peekId);
  const spokenCount = roster.reduce(
    (count, entry) => count + (spoken.has(entry.member.id) ? 1 : 0),
    0,
  );

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
        {roster.length > 0 ? (
          <span data-numeric className="text-2xs text-faint" data-testid="standup-progress">
            {spokenCount} of {roster.length} spoken
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {timerOn ? <StandupTimer startedAt={openedAt.getTime()} /> : null}
          {roster.length > 0 ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                data-testid="shuffle-standup"
                onClick={randomise}
                title="Shuffle the speaking order"
              >
                <Shuffle className="size-3.5" aria-hidden="true" />
                Shuffle
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="reset-standup"
                onClick={reset}
                title="Clear who has spoken"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Reset
              </Button>
              <Button size="sm" variant="secondary" data-testid="next-speaker" onClick={goNext}>
                Next
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          ) : null}
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
        roster={roster}
        selected={selected}
        stages={stages}
        currentId={selected?.member.id ?? null}
        spoken={spoken}
        onSelect={select}
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
  readonly roster: readonly RosterEntry[];
  readonly selected: RosterEntry | undefined;
  readonly stages: ReturnType<typeof stageGroups>;
  readonly currentId: string | null;
  readonly spoken: ReadonlySet<string>;
  readonly onSelect: (userId: string) => void;
  readonly onPeek: (issueId: string) => void;
  readonly onRetry: () => void;
}

function BoardBody({
  loading,
  failed,
  roster,
  selected,
  stages,
  currentId,
  spoken,
  onSelect,
  onPeek,
  onRetry,
}: BoardBodyProps) {
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

  if (roster.length === 0 || selected === undefined) {
    return (
      <EmptyState
        icon={<Users strokeWidth={1.75} aria-hidden="true" />}
        title="Nobody has work on the board"
        description="Assign an issue and its owner joins the standup with everything they are carrying."
        className="flex-1"
      />
    );
  }

  return (
    <>
      <PersonTiles roster={roster} currentId={currentId} spoken={spoken} onSelect={onSelect} />
      <StageColumns stages={stages} assignee={selected.member} onOpen={onPeek} />
    </>
  );
}
