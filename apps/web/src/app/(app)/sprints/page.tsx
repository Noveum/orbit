import { can } from '@orbit/shared/policy';
import { RefreshCcw } from 'lucide-react';
import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { CycleAnalytics, CycleIssueList } from '@/features/sprints/cycle-board.tsx';
import {
  getActiveCycleView,
  getSprintView,
  listPastSprintViews,
  listUpcomingCycleViews,
  runningSprintNumber,
} from '@/features/sprints/data.ts';
import { NewSprintButton } from '@/features/sprints/sprint-actions.tsx';
import { SprintHeader } from '@/features/sprints/sprint-header.tsx';
import { SprintHistory } from '@/features/sprints/sprint-history.tsx';
import { SprintSchedule } from '@/features/sprints/sprint-schedule.tsx';
import { parseSprintTab, SprintTabs } from '@/features/sprints/sprint-tabs.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Sprints' };

interface PageProps {
  readonly searchParams: Promise<{ tab?: string; sprint?: string }>;
}

const SPRINT_NUMBER = /^[1-9][0-9]{0,8}$/;

function sprintNumber(value: string | undefined): number | null {
  return value !== undefined && SPRINT_NUMBER.test(value) ? Number(value) : null;
}

export default async function SprintsPage({ searchParams }: PageProps) {
  const { principal } = await pageContext();
  const canManage = can(principal, 'cycle:manage');

  const { tab, sprint: wanted } = await searchParams;
  const chosen = sprintNumber(wanted);

  const [sprint, upcoming, past, running] = await Promise.all([
    chosen === null ? getActiveCycleView(principal) : getSprintView(principal, chosen),
    listUpcomingCycleViews(principal),
    listPastSprintViews(principal),
    runningSprintNumber(principal),
  ]);

  const active = parseSprintTab(tab);
  const base = chosen === null ? '/sprints' : `/sprints?sprint=${chosen}`;
  const outcome = sprint?.outcome ?? null;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      {sprint === null ? (
        <EmptyState
          icon={<RefreshCcw strokeWidth={1.75} aria-hidden="true" />}
          title="No sprint running"
          description="A sprint covers the whole workspace and holds work from every team."
          action={canManage ? <NewSprintButton /> : null}
        />
      ) : (
        <>
          <SprintHeader sprint={sprint} canManage={canManage} />
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
        </>
      )}

      <SprintSchedule upcoming={upcoming} canManage={canManage} running={running !== null} />

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-dense text-text">Past sprints</h3>
        <SprintHistory sprints={past} />
      </section>
    </div>
  );
}
