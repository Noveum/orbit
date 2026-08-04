'use client';

import { CircleCheck, UserMinus } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import type { StandupTurn, StandupWorkload } from '@/lib/query/schemas.ts';

export interface RosterProps {
  readonly turns: readonly StandupTurn[];
  readonly currentTurnId: string | null;
  readonly workloadByUser: ReadonlyMap<string, StandupWorkload>;
  readonly presenting: boolean;
  readonly onFocus: (turnId: string) => void;
}

function TurnMarker({
  turn,
  workload,
}: {
  readonly turn: StandupTurn;
  readonly workload: StandupWorkload | undefined;
}) {
  if (turn.attendance === 'absent') {
    return <UserMinus className="size-3.5 text-faint" aria-label="Absent" />;
  }
  if (turn.status === 'done') {
    return <CircleCheck className="size-3.5 text-success" aria-label="Spoken" />;
  }
  if (turn.status === 'speaking') {
    return <span className="size-1.5 rounded-full bg-accent" role="img" aria-label="Speaking" />;
  }
  if (workload === undefined) return null;
  return (
    <span data-numeric className="text-2xs text-faint">
      {workload.inProgress}
    </span>
  );
}

export function Roster({ turns, currentTurnId, workloadByUser, presenting, onFocus }: RosterProps) {
  const workspace = useWorkspace();

  return (
    <ol
      className={cn(
        'flex shrink-0 flex-col gap-0.5 overflow-y-auto border-border border-r p-2',
        presenting ? 'w-64' : 'w-72',
      )}
      data-testid="standup-roster"
    >
      {turns.map((turn) => {
        const member = workspace.memberById.get(turn.userId);
        const active = turn.id === currentTurnId;
        return (
          <li key={turn.id}>
            <button
              type="button"
              data-testid={`roster-${turn.userId}`}
              onClick={() => onFocus(turn.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                active ? 'bg-accent/12 text-text' : 'text-muted hover:bg-surface-2',
                turn.attendance === 'absent' && 'opacity-50',
              )}
            >
              <Avatar name={member?.name ?? 'Unknown'} src={member?.image ?? null} size="xs" />
              <span className="min-w-0 flex-1 truncate text-dense">
                {member?.name ?? 'Unknown member'}
              </span>
              <TurnMarker turn={turn} workload={workloadByUser.get(turn.userId)} />
            </button>
          </li>
        );
      })}
      {turns.length === 0 ? (
        <li className="px-2 py-3 text-2xs text-faint">Nobody is in this team's rotation yet.</li>
      ) : null}
    </ol>
  );
}
