'use client';

import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { AnalyticsCard } from './analytics-card.tsx';
import { AnalyticsDrilldownDialog } from './analytics-drilldown-dialog.tsx';
import {
  personCaptureCaption,
  personIdealSeries,
  sprintDays,
  todayDateOf,
  unestimatedNote,
} from './burn-math.ts';
import { type AnalyticsDataRow, AnalyticsDataTable } from './charts/analytics-data-table.tsx';
import { BarPlot } from './charts/bar-plot.tsx';
import { LinePlot, type PlotSeries } from './charts/line-plot.tsx';
import type { AnalyticsPeopleResponse } from './contracts.ts';
import { usesCurrentPersonDefault } from './person-focus.ts';

type PersonRow = AnalyticsPeopleResponse['people'][number];
type FocusedPerson = NonNullable<AnalyticsPeopleResponse['focused']>;
type PersonSprintBurnPoints = NonNullable<FocusedPerson['sprintBurn']['current']>['burn'];

interface EvidenceSelection {
  readonly title: string;
  readonly cohort: AnalyticsDrilldownCohort;
}

const statusLabels = {
  current: 'Current member',
  former: 'Former member',
  deleted: 'Deleted member',
  unassigned: 'Unassigned',
} as const;

function numberLabel(value: number | null): string {
  if (value === null) return 'Not enough data';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function peopleRows(people: readonly PersonRow[], points: boolean): AnalyticsDataRow[] {
  return people.map((row) => ({
    id: row.person.id,
    label: `${points ? row.currentPoints : row.currentAssignments} assigned, ${points ? row.completedPoints : row.completedIssues} completed`,
    cells: {
      person: row.person.name,
      status: statusLabels[row.person.status],
      assigned: points ? row.currentPoints : row.currentAssignments,
      completed: points ? row.completedPoints : row.completedIssues,
      average: numberLabel(points ? row.averageThroughputPoints : row.averageThroughputIssues),
      wip: points ? row.currentWipPoints : row.currentWip,
    },
  }));
}

function PersonFlowCards({
  focused,
  formulas,
}: {
  readonly focused: NonNullable<AnalyticsPeopleResponse['focused']>;
  readonly formulas: AnalyticsPeopleResponse['formulas'];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {[
        ['Cycle time', focused.cycleTime, formulas.cycleTime],
        ['Lead time', focused.leadTime, formulas.leadTime],
        ['WIP age', focused.wipAge, formulas.wipAge],
      ].map(([title, distribution, formula]) => {
        const values = distribution as typeof focused.cycleTime;
        return (
          <AnalyticsCard key={String(title)} title={String(title)}>
            <p className="font-semibold text-2xl text-text">
              {values.p50 === null ? 'No data' : `${numberLabel(values.p50)}d`}
            </p>
            <p className="text-faint text-xs">p50 · p85 {numberLabel(values.p85)}d</p>
            <p className="text-muted text-xs">{String(formula)}</p>
          </AnalyticsCard>
        );
      })}
    </div>
  );
}

function PersonTimeline({
  focused,
  points,
  activate,
}: {
  readonly focused: NonNullable<AnalyticsPeopleResponse['focused']>;
  readonly points: boolean;
  readonly activate: (title: string, cohort: AnalyticsDrilldownCohort) => void;
}) {
  return (
    <AnalyticsCard title="Assignment and completion activity">
      {focused.timeline.length === 0 ? (
        <p className="py-8 text-center text-muted text-xs">No activity in this range.</p>
      ) : (
        <LinePlot
          label={`${focused.person.name} assignment and completion activity`}
          onActivate={(cohort) => activate('Personal activity evidence', cohort)}
          series={[
            {
              id: 'assigned',
              label: 'Assigned',
              points: focused.timeline.map((point) => ({
                id: `${point.date}-assigned`,
                label: point.date,
                value: points ? point.assignedPoints : point.assignedIssues,
                cohort: point.assignedCohort,
              })),
            },
            {
              id: 'completed',
              label: 'Completed',
              points: focused.timeline.map((point) => ({
                id: `${point.date}-completed`,
                label: point.date,
                value: points ? point.completedPoints : point.completedIssues,
                cohort: point.completedCohort,
              })),
            },
          ]}
          xAxisLabel="Reporting period"
          yAxisLabel={points ? 'Points' : 'Issues'}
        />
      )}
    </AnalyticsCard>
  );
}

function personRemainingSeries(burn: PersonSprintBurnPoints): PlotSeries {
  return {
    id: 'current-person',
    label: 'Current sprint',
    color: 1,
    points: burn
      .filter((point) => point.available && !point.future)
      .map((point) => ({
        id: `${point.date}-current-person`,
        label: point.date,
        value: point.remaining,
        cohort: { cohort: 'open' as const },
      })),
  };
}

function PersonalSprintBurn({
  focused,
  points,
}: {
  readonly focused: NonNullable<AnalyticsPeopleResponse['focused']>;
  readonly points: boolean;
}) {
  const current = focused.sprintBurn.current;
  const selected = focused.sprintBurn.selected;
  const previous = focused.sprintBurn.previous;
  if (current === null || selected === null) {
    return (
      <AnalyticsCard title="Personal sprint burn">
        <p className="py-8 text-center text-muted text-xs">
          Personal burn appears when this person has work in a sprint.
        </p>
      </AnalyticsCard>
    );
  }
  const unit = points ? 'points' : 'issues';
  const captureAnnotation = personCaptureCaption(current.burn);
  return (
    <AnalyticsCard title="Personal sprint burn">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-text">{selected.name}</p>
          <p className="mt-1 text-muted text-xs">
            {numberLabel(current.summary.remaining)} {unit} remaining
          </p>
        </div>
        <p className="text-faint text-xs">{current.coverage.kind}</p>
      </div>
      <LinePlot
        {...(captureAnnotation === undefined ? {} : { annotation: captureAnnotation })}
        days={sprintDays(current.burn, todayDateOf(current.burn))}
        label={`${focused.person.name} personal sprint burn`}
        series={[personRemainingSeries(current.burn), personIdealSeries(current.burn)]}
        valueFormatter={(value) => `${numberLabel(value)} ${unit}`}
        xAxisLabel="Sprint day"
        yAxisLabel={`Remaining ${unit}`}
      />
      {previous === null ? null : (
        <p className="text-faint text-xs">
          Previous sprint ended with {numberLabel(previous.summary.remaining)} {unit} remaining.
        </p>
      )}
      <p className="text-faint text-xs">
        Uses assignment history at each sprint point, not only current ownership.
      </p>
    </AnalyticsCard>
  );
}

function PersonGroups({
  focused,
  points,
  activate,
}: {
  readonly focused: NonNullable<AnalyticsPeopleResponse['focused']>;
  readonly points: boolean;
  readonly activate: (title: string, cohort: AnalyticsDrilldownCohort) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[
        ['Projects', focused.projects],
        ['States', focused.states],
        ['Milestones', focused.milestones],
        ['Sprints', focused.sprints],
      ].map(([label, groups]) => (
        <AnalyticsCard key={String(label)} title={String(label)}>
          {(groups as typeof focused.projects).length === 0 ? (
            <p className="py-8 text-center text-muted text-xs">No matching work.</p>
          ) : (
            <BarPlot
              label={`${focused.person.name} ${String(label).toLowerCase()}`}
              onActivate={(cohort) => activate(`${String(label)} evidence`, cohort)}
              points={(groups as typeof focused.projects).map((group) => ({
                id: group.id,
                label: group.name,
                value: points ? group.points : group.issues,
                cohort: group.cohort,
              }))}
              xAxisLabel={points ? 'Points' : 'Issues'}
            />
          )}
        </AnalyticsCard>
      ))}
    </div>
  );
}

function FocusedPerson({
  focused,
  query,
  formulas,
  activate,
}: {
  readonly focused: NonNullable<AnalyticsPeopleResponse['focused']>;
  readonly query: AnalyticsQuery;
  readonly formulas: AnalyticsPeopleResponse['formulas'];
  readonly activate: (title: string, cohort: AnalyticsDrilldownCohort) => void;
}) {
  const points = query.measure === 'points';
  const metrics = [
    [
      'Current assignments',
      points ? focused.currentPoints : focused.currentAssignments,
      focused.cohorts.currentAssignments,
    ],
    [
      'Completed in range',
      points ? focused.completedPoints : focused.completedIssues,
      focused.cohorts.completed,
    ],
    [
      'Average throughput',
      points ? focused.averageThroughputPoints : focused.averageThroughputIssues,
      focused.cohorts.completed,
    ],
    [
      'Work in progress',
      points ? focused.currentWipPoints : focused.currentWip,
      focused.cohorts.wip,
    ],
  ] as const;

  return (
    <div className="grid gap-4">
      <AnalyticsCard>
        <div className="flex items-start gap-3">
          <Avatar name={focused.person.name} size="md" src={focused.person.image} />
          <div className="min-w-0 flex-1">
            <p className="text-accent text-xs">
              {usesCurrentPersonDefault(query) ? 'My work' : 'Selected person'}
            </p>
            <h2 className="mt-1 truncate font-medium text-base text-text">{focused.person.name}</h2>
            <p className="mt-1 text-faint text-xs">{statusLabels[focused.person.status]}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map(([label, value, cohort]) => (
            <button
              className="rounded-md border border-border bg-surface-2 p-3 text-left hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              key={label}
              onClick={() => activate(label, cohort)}
              type="button"
            >
              <span className="block font-semibold text-xl text-text">{numberLabel(value)}</span>
              <span className="text-faint text-xs">{label}</span>
              {label === 'Average throughput' ? (
                <span className="block text-faint text-2xs">per active week</span>
              ) : null}
            </button>
          ))}
        </div>
        <p className="text-faint text-xs">{formulas.activeWeek}</p>
        {focused.attribution.kind === 'captured' ? null : (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-muted text-xs">
            Some completion ownership was reconstructed from assignment history or current
            ownership. {formulas.attribution}
          </p>
        )}
        {points && focused.unestimated > 0 ? (
          <p className="text-muted text-xs">{unestimatedNote(focused.unestimated)}</p>
        ) : null}
      </AnalyticsCard>
      <PersonFlowCards focused={focused} formulas={formulas} />
      <PersonalSprintBurn focused={focused} points={points} />
      <PersonTimeline activate={activate} focused={focused} points={points} />
      <PersonGroups activate={activate} focused={focused} points={points} />
    </div>
  );
}

function PeopleTable({
  data,
  points,
  onFocusPerson,
}: {
  readonly data: AnalyticsPeopleResponse;
  readonly points: boolean;
  readonly onFocusPerson: (personId: string) => void;
}) {
  const people = data.people.toSorted((left, right) =>
    left.person.name.localeCompare(right.person.name),
  );
  const unit = points ? 'points' : 'issues';
  return (
    <AnalyticsCard>
      <div>
        <h2 className="font-medium text-sm text-text">People</h2>
        <p className="mt-1 text-muted text-xs">
          Workspace workload and delivery, sorted alphabetically. Values describe work, not
          performance.
        </p>
      </div>
      {people.length === 0 ? (
        <p className="py-10 text-center text-muted text-sm">No people match this view.</p>
      ) : (
        <AnalyticsDataTable
          ariaLabel="People workload"
          columns={[
            { id: 'person', label: 'Person' },
            { id: 'status', label: 'Status' },
            { id: 'assigned', label: `Assigned ${unit}`, align: 'right' },
            { id: 'completed', label: `Completed ${unit}`, align: 'right' },
            { id: 'average', label: 'Average per active week', align: 'right' },
            { id: 'wip', label: `WIP ${unit}`, align: 'right' },
          ]}
          onActivate={(row) => onFocusPerson(row.id)}
          rows={peopleRows(people, points)}
        />
      )}
      {data.truncated ? <p className="text-faint text-xs">Showing 100 people.</p> : null}
    </AnalyticsCard>
  );
}

export function PeopleLens({
  data,
  query,
  onFocusPerson,
}: {
  readonly data: AnalyticsPeopleResponse;
  readonly query: AnalyticsQuery;
  readonly onFocusPerson: (personId: string) => void;
}) {
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const points = query.measure === 'points';
  const focused = data.focused;
  const activate = (title: string, cohort: AnalyticsDrilldownCohort) =>
    setEvidence({ title, cohort });

  return (
    <div className="grid gap-4">
      {focused === null ? null : (
        <FocusedPerson
          activate={activate}
          focused={focused}
          formulas={data.formulas}
          query={query}
        />
      )}
      <PeopleTable data={data} onFocusPerson={onFocusPerson} points={points} />

      {evidence === null ? null : (
        <AnalyticsDrilldownDialog
          cohort={evidence.cohort}
          onOpenChange={(open) => {
            if (!open) setEvidence(null);
          }}
          open
          query={query}
          title={evidence.title}
        />
      )}
    </div>
  );
}
