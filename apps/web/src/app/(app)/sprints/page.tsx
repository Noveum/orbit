import { listSprintRollUp } from '@orbit/core';
import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { SprintRollUp, type SprintRollUpEntry } from '@/features/sprints/sprint-roll-up.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export const metadata: Metadata = { title: 'Sprints' };

export default async function SprintsPage() {
  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);
  const rows = await listSprintRollUp(
    principal,
    teams.map((team) => team.id),
  );
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));

  const entries: SprintRollUpEntry[] = teams.map((team) => ({
    team,
    sprint: byTeam.get(team.id) ?? null,
  }));

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg text-text">Sprints</h1>
        <p className="text-muted text-xs">One row per team. Open a team to plan its sprint.</p>
      </header>
      <SprintRollUp entries={entries} canManage={can(principal, 'cycle:manage')} />
    </div>
  );
}
