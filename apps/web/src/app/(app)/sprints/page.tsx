import { can } from '@orbit/shared/policy';
import { RefreshCcw } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { CyclePanel } from '@/features/cycles/cycle-board.tsx';
import {
  getActiveCycleView,
  listPastSprintViews,
  listUpcomingCycleViews,
} from '@/features/cycles/data.ts';
import { SprintHistory } from '@/features/cycles/sprint-history.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export const metadata: Metadata = { title: 'Sprints' };

export default async function SprintsPage() {
  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);

  if (teams.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCcw strokeWidth={1.75} aria-hidden="true" />}
        title="No teams yet"
        description="Sprints belong to a team. Create one in workspace settings first."
      />
    );
  }

  const canManage = can(principal, 'cycle:manage');
  const panels = await Promise.all(
    teams.map(async (team) => ({
      team,
      cycle: await getActiveCycleView(principal, team),
      upcoming: await listUpcomingCycleViews(principal, team),
      past: await listPastSprintViews(principal, team),
    })),
  );

  return (
    <div className="flex flex-col gap-10 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Sprints</h1>
        <p className="text-muted text-xs">
          Every team runs its own cadence. Active sprints first, upcoming below.
        </p>
      </header>
      {panels.map((panel) => (
        <section key={panel.team.id} className="flex flex-col gap-4">
          <CyclePanel
            cycle={panel.cycle}
            upcoming={panel.upcoming}
            team={panel.team}
            canManage={canManage}
            runningSprintId={panel.cycle?.id ?? null}
          />
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-dense text-text">Past sprints</h3>
            <SprintHistory sprints={panel.past} />
          </div>
        </section>
      ))}
    </div>
  );
}
