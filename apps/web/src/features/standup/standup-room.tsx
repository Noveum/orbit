'use client';

import { ChevronLeft, ChevronRight, CircleSlash, Flag, Play } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { StandupDetail, StandupWorkload } from '@/lib/query/schemas.ts';
import {
  useAddBlocker,
  useAdvanceStandup,
  useFinishStandup,
  useFocusTurn,
  useOpenStandup,
  useResolveBlocker,
  useStartStandup,
  useUpdateTurn,
} from '@/lib/query/use-standup.ts';
import { Roster } from './roster.tsx';
import { TurnPanel } from './turn-panel.tsx';

export interface StandupRoomProps {
  readonly teamId: string | null;
  readonly teamName: string;
  readonly detail: StandupDetail | null;
  readonly workload: readonly StandupWorkload[];
  readonly loading: boolean;
}

export function StandupRoom(props: StandupRoomProps) {
  const { teamId, teamName, detail, loading } = props;
  const open = useOpenStandup(teamId);

  if (teamId === null) {
    return (
      <EmptyState
        icon={<Flag strokeWidth={1.75} aria-hidden="true" />}
        title="Pick a team"
        description="Standup runs per team. Choose one above to begin."
        className="flex-1"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="h-8 w-64 animate-pulse rounded-md bg-surface-2" />
        <div className="h-40 w-full animate-pulse rounded-lg bg-surface-2" />
      </div>
    );
  }

  if (detail === null) {
    return (
      <EmptyState
        icon={<Play strokeWidth={1.75} aria-hidden="true" />}
        title={`No standup for ${teamName} today`}
        description="Open the room to seat everyone in the rotation and pick today's facilitator."
        className="flex-1"
        action={
          <Button
            size="sm"
            variant="primary"
            data-testid="open-standup"
            onClick={() => open.mutate(undefined)}
            disabled={open.isPending}
          >
            {open.isPending ? 'Opening' : 'Open standup'}
          </Button>
        }
      />
    );
  }

  return <RunningRoom {...props} teamId={teamId} detail={detail} />;
}

interface RunningRoomProps extends StandupRoomProps {
  readonly teamId: string;
  readonly detail: StandupDetail;
}

function RunningRoom({ teamId, teamName, detail, workload }: RunningRoomProps) {
  const workspace = useWorkspace();
  const start = useStartStandup(teamId);
  const advance = useAdvanceStandup(teamId);
  const focus = useFocusTurn(teamId);
  const updateTurn = useUpdateTurn(teamId);
  const addBlocker = useAddBlocker(teamId);
  const resolveBlocker = useResolveBlocker(teamId);
  const finish = useFinishStandup(teamId);
  const [presenting, setPresenting] = useState(false);

  const { standup, turns } = detail;
  const running = standup.status === 'running';

  const current = useMemo(
    () => turns.find((turn) => turn.id === standup.currentTurnId) ?? null,
    [turns, standup.currentTurnId],
  );

  const workloadByUser = useMemo(
    () => new Map(workload.map((entry) => [entry.userId, entry])),
    [workload],
  );

  const move = useCallback(
    (direction: 'next' | 'previous') => {
      if (!running || advance.isPending) return;
      advance.mutate({ standupId: standup.id, direction });
    },
    [standup.id, running, advance],
  );

  useHotkey('right', () => move('next'), {
    label: 'Next person',
    section: 'Standup',
    scope: 'standup',
    enabled: running,
  });
  useHotkey('left', () => move('previous'), {
    label: 'Previous person',
    section: 'Standup',
    scope: 'standup',
    enabled: running,
  });
  useHotkey('p', () => setPresenting((value) => !value), {
    label: 'Toggle presenter mode',
    section: 'Standup',
    scope: 'standup',
  });

  const facilitator =
    standup.facilitatorId === null ? undefined : workspace.memberById.get(standup.facilitatorId);
  const spoken = turns.filter((turn) => turn.status === 'done').length;
  const expected = turns.filter((turn) => turn.attendance !== 'absent').length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="standup-room">
      <header className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-medium text-dense text-text">{teamName} standup</h1>
          <span data-numeric className="text-2xs text-faint">
            {standup.heldOn}
          </span>
        </div>

        {facilitator === undefined ? null : (
          <span
            className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-2.5 pl-1"
            data-testid="facilitator"
          >
            <Avatar name={facilitator.name} src={facilitator.image} size="xs" />
            <span className="text-2xs text-muted">{facilitator.name} is facilitating</span>
          </span>
        )}

        <span data-numeric className="text-2xs text-faint" data-testid="standup-progress">
          {spoken} of {expected} spoken
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setPresenting((value) => !value)}>
            {presenting ? 'Exit presenter' : 'Presenter'}
          </Button>
          {standup.status === 'scheduled' ? (
            <Button
              size="sm"
              variant="primary"
              data-testid="start-standup"
              onClick={() => start.mutate(standup.id)}
              disabled={start.isPending}
            >
              Start
            </Button>
          ) : null}
          {running ? (
            <RoomControls
              onPrevious={() => move('previous')}
              onNext={() => move('next')}
              onFinish={() => finish.mutate(standup.id)}
            />
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Roster
          turns={turns}
          currentTurnId={standup.currentTurnId}
          workloadByUser={workloadByUser}
          presenting={presenting}
          onFocus={(turnId) => focus.mutate({ standupId: standup.id, turnId })}
        />

        <div className="min-w-0 flex-1 overflow-y-auto">
          {current === null ? (
            <EmptyState
              icon={<CircleSlash strokeWidth={1.75} aria-hidden="true" />}
              title={standup.status === 'finished' ? 'Standup finished' : 'Nobody is speaking'}
              description={
                standup.status === 'finished'
                  ? 'Every blocker raised today stays on the team board until it is resolved.'
                  : 'Press Start, or pick someone from the list to begin.'
              }
              className="flex-1"
            />
          ) : (
            <TurnPanel
              key={current.id}
              standupId={standup.id}
              teamId={teamId}
              turn={current}
              member={workspace.memberById.get(current.userId)}
              workload={workloadByUser.get(current.userId)}
              blockers={detail.blockers}
              presenting={presenting}
              onSaveNotes={(notes) =>
                updateTurn.mutate({ standupId: standup.id, turnId: current.id, notes })
              }
              onAttendance={(attendance) =>
                updateTurn.mutate({ standupId: standup.id, turnId: current.id, attendance })
              }
              onAddBlocker={(summary, issueId) =>
                addBlocker.mutate({ standupId: standup.id, turnId: current.id, summary, issueId })
              }
              onResolveBlocker={(blockerId, resolved) =>
                resolveBlocker.mutate({ standupId: standup.id, blockerId, resolved })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RoomControls({
  onPrevious,
  onNext,
  onFinish,
}: {
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onFinish: () => void;
}) {
  return (
    <>
      <Button size="sm" variant="secondary" aria-label="Previous person" onClick={onPrevious}>
        <ChevronLeft className="size-3.5" aria-hidden="true" />
      </Button>
      <Button size="sm" variant="primary" data-testid="next-person" onClick={onNext}>
        Next
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onFinish}>
        Finish
      </Button>
    </>
  );
}
