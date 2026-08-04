'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import { useStandupToday } from '@/lib/query/use-standup.ts';
import { StandupRoom } from './standup-room.tsx';

const TEAM_PARAM = 'team';

export function StandupPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();

  const requested = searchParams.get(TEAM_PARAM);
  const team = useMemo(() => {
    const match = workspace.teams.find(
      (entry) => entry.key.toLowerCase() === (requested ?? '').toLowerCase(),
    );
    return match ?? workspace.teams[0];
  }, [workspace.teams, requested]);

  const teamId = team?.id ?? null;
  const today = useStandupToday(teamId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {workspace.teams.length > 1 ? (
        <nav
          className="flex shrink-0 items-center gap-1 border-border border-b px-3 py-1.5"
          aria-label="Standup team"
        >
          {workspace.teams.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid={`standup-team-${entry.key.toLowerCase()}`}
              onClick={() => router.replace(`/standup?${TEAM_PARAM}=${entry.key.toLowerCase()}`)}
              className={cn(
                'rounded-md px-2 py-1 text-2xs',
                'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                entry.id === teamId ? 'bg-surface-2 text-text' : 'text-faint hover:text-muted',
              )}
            >
              {entry.name}
            </button>
          ))}
        </nav>
      ) : null}

      <StandupRoom
        teamId={teamId}
        teamName={team?.name ?? 'Team'}
        detail={today.data?.standup ?? null}
        workload={today.data?.workload ?? []}
        loading={!workspace.ready || today.isPending}
      />
    </div>
  );
}
