import { can } from '@orbit/shared/policy';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { RefreshCcw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { loadSelectedSprintAnalyticsData } from '@/features/analytics/data.ts';
import { SprintLens } from '@/features/analytics/sprint-lens.tsx';
import {
  getActiveSprintChrome,
  getSprintChrome,
  listPastSprintViews,
  listUpcomingCycleViews,
  runningSprintNumber,
} from '@/features/sprints/data.ts';
import { NewSprintButton } from '@/features/sprints/sprint-actions.tsx';
import { SprintHeader } from '@/features/sprints/sprint-header.tsx';
import { SprintHistory } from '@/features/sprints/sprint-history.tsx';
import { SprintIssues } from '@/features/sprints/sprint-issues.tsx';
import { SprintSchedule } from '@/features/sprints/sprint-schedule.tsx';
import { parseSprintTab, SprintTabs } from '@/features/sprints/sprint-tabs.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';

export const metadata: Metadata = { title: 'Sprints' };

interface PageProps {
  readonly searchParams: Promise<{ tab?: string; sprint?: string }>;
}

const SPRINT_NUMBER = /^[1-9][0-9]{0,8}$/;
const sprintAnalyticsQuery = analyticsQuerySchema.parse({
  lens: 'sprints',
  range: { preset: 'active_sprint' },
});

function sprintNumber(value: string | undefined): number | null {
  return value !== undefined && SPRINT_NUMBER.test(value) ? Number(value) : null;
}

export default async function SprintsPage({ searchParams }: PageProps) {
  const { principal } = await pageContext();
  const canManage = can(principal, 'cycle:manage');

  const { tab, sprint: wanted } = await searchParams;
  const chosen = sprintNumber(wanted);
  const active = parseSprintTab(tab);

  const sprintPromise =
    chosen === null ? getActiveSprintChrome(principal) : getSprintChrome(principal, chosen);
  const analyticsPromise =
    active === 'insights'
      ? sprintPromise.then(async (sprint) =>
          sprint === null
            ? null
            : await loadSelectedSprintAnalyticsData(principal, sprintAnalyticsQuery, sprint.id),
        )
      : Promise.resolve(null);
  const [sprint, analytics, upcoming, past, running] = await Promise.all([
    sprintPromise,
    analyticsPromise,
    listUpcomingCycleViews(principal),
    listPastSprintViews(principal),
    runningSprintNumber(principal),
  ]);
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
          <SprintTabs base={base} active={active} available={['board', 'list', 'insights']} />
          {active === 'insights' && analytics !== null ? (
            <SprintLens data={analytics} query={sprintAnalyticsQuery} />
          ) : (
            <SprintIssues
              cycleId={sprint.id}
              sprintName={sprint.name}
              layout={active === 'list' ? 'list' : 'board'}
            />
          )}
        </>
      )}

      <SprintSchedule upcoming={upcoming} canManage={canManage} running={running !== null} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-dense text-text">Past sprints</h3>
          <Link
            href="/sprints/all"
            data-testid="sprint-browse-all"
            className={cn(
              'rounded-md px-2 py-1 text-muted text-xs outline-none',
              'focus-visible:ring-2 focus-visible:ring-accent',
              rowHover,
            )}
          >
            Browse every sprint
          </Link>
        </div>
        <SprintHistory sprints={past} />
      </section>
    </div>
  );
}
