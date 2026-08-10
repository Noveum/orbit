import { Badge } from '@/components/ui/badge.tsx';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import type { UpcomingCycleView } from './data.ts';
import {
  DeleteSprintButton,
  EditSprintButton,
  NewSprintButton,
  StartSprintButton,
} from './sprint-actions.tsx';

export interface ScheduleTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function SprintSchedule({
  upcoming,
  team,
  canManage,
  runningSprintId,
}: {
  readonly upcoming: readonly UpcomingCycleView[];
  readonly team: ScheduleTeam;
  readonly canManage: boolean;
  readonly runningSprintId: string | null;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="sprint-schedule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-dense text-text">Upcoming sprints</h3>
        {canManage ? <NewSprintButton teamId={team.id} /> : null}
      </div>
      {upcoming.length === 0 ? (
        <p className="text-faint text-xs">Nothing scheduled after this one.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {upcoming.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5',
                cardHover,
              )}
            >
              <span className="flex items-center gap-2 text-dense text-text">
                <Badge tone="outline">{entry.teamKey}</Badge>
                {entry.name}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-2xs text-faint tabular">
                  {formatDay(entry.startsAt)} to {formatDay(entry.endsAt)}
                </span>
                {canManage ? (
                  <>
                    {runningSprintId === null ? <StartSprintButton sprint={entry} /> : null}
                    <EditSprintButton sprint={entry} />
                    <DeleteSprintButton sprint={entry} />
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
