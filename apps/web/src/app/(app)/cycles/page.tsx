import { RefreshCcw } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { CyclePanel } from '@/features/cycles/cycle-board.tsx';
import { getActiveCycleView, listUpcomingCycleViews } from '@/features/cycles/data.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export const metadata: Metadata = { title: 'Cycles' };

export default async function CyclesPage() {
  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);

  if (teams.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCcw strokeWidth={1.75} aria-hidden="true" />}
        title="No teams yet"
        description="Cycles belong to a team. Create one in workspace settings first."
      />
    );
  }

  const panels = await Promise.all(
    teams.map(async (team) => ({
      team,
      cycle: await getActiveCycleView(principal, team),
      upcoming: await listUpcomingCycleViews(principal, team),
    })),
  );

  return (
    <div className="flex flex-col gap-10 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Cycles</h1>
        <p className="text-muted text-xs">
          Every team runs its own cadence. Active cycles first, upcoming below.
        </p>
      </header>
      {panels.map((panel) => (
        <CyclePanel
          key={panel.team.id}
          cycle={panel.cycle}
          upcoming={panel.upcoming}
          teamName={panel.team.name}
        />
      ))}
    </div>
  );
}
