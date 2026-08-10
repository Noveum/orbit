import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CycleAnalytics, CycleIssueList } from '@/features/sprints/cycle-board.tsx';
import {
  getSprintView,
  listPastSprintViews,
  listUpcomingCycleViews,
  runningSprintId,
} from '@/features/sprints/data.ts';
import { SprintHeader } from '@/features/sprints/sprint-header.tsx';
import { SprintHistory } from '@/features/sprints/sprint-history.tsx';
import { SprintSchedule } from '@/features/sprints/sprint-schedule.tsx';
import { parseSprintTab, SprintTabs } from '@/features/sprints/sprint-tabs.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

interface PageProps {
  readonly params: Promise<{ key: string; number: string }>;
  readonly searchParams: Promise<{ tab?: string }>;
}

const SPRINT_NUMBER = /^[1-9][0-9]{0,8}$/;

function sprintNumber(value: string): number | null {
  return SPRINT_NUMBER.test(value) ? Number(value) : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { key, number } = await params;
  return { title: `${key.toUpperCase()} sprint ${number}` };
}

export default async function SprintPage({ params, searchParams }: PageProps) {
  const { key, number } = await params;
  const wanted = sprintNumber(number);
  if (wanted === null) notFound();

  const { principal } = await pageContext();
  const teams = await listTeamsForPrincipal(principal);
  const team = teams.find((entry) => entry.key.toLowerCase() === key.toLowerCase());
  if (team === undefined) notFound();

  const [sprint, upcoming, past, running, { tab }] = await Promise.all([
    getSprintView(principal, team, wanted),
    listUpcomingCycleViews(principal, team),
    listPastSprintViews(principal, team),
    runningSprintId(principal, team),
    searchParams,
  ]);
  if (sprint === null) notFound();

  const canManage = can(principal, 'cycle:manage');
  const active = parseSprintTab(tab);
  const base = `/team/${key.toLowerCase()}/sprint/${wanted}`;
  const outcome = sprint.outcome;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <SprintHeader sprint={sprint} teamKey={team.key} canManage={canManage} />
      {outcome === null ? null : (
        <p className="text-muted text-xs tabular-nums" data-testid="sprint-outcome">
          Closed with {outcome.completed} of {outcome.scope} done
          {outcome.rolledOver > 0 ? `, ${outcome.rolledOver} rolled into the next sprint` : ''}.
        </p>
      )}

      <SprintTabs base={base} active={active} available={['board', 'insights']} />

      {active === 'insights' ? (
        <CycleAnalytics cycle={sprint} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <CycleIssueList cycle={sprint} />
          <CycleAnalytics cycle={sprint} />
        </div>
      )}

      <SprintSchedule
        upcoming={upcoming}
        team={team}
        canManage={canManage}
        runningSprintId={running}
      />

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-dense text-text">Past sprints</h3>
        <SprintHistory sprints={past} />
      </section>
    </div>
  );
}
