'use client';

import type { AnalyticsDrilldownCohort, AnalyticsQuery } from '@orbit/shared/validators';
import { useState } from 'react';
import { AnalyticsCard } from './analytics-card.tsx';
import { AnalyticsDrilldownDialog } from './analytics-drilldown-dialog.tsx';
import { unestimatedNote } from './burn-math.ts';
import { type AnalyticsDataRow, AnalyticsDataTable } from './charts/analytics-data-table.tsx';
import { LinePlot } from './charts/line-plot.tsx';
import type { AnalyticsProjectsResponse } from './contracts.ts';

type Project = AnalyticsProjectsResponse['projects'][number];
type ProjectSort = 'name' | 'risk' | 'target';

interface EvidenceSelection {
  readonly title: string;
  readonly cohort: AnalyticsDrilldownCohort;
}

const healthLabels = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  no_update: 'No update',
} as const;

function riskOf(project: Project): number {
  return project.blocked + project.overdue + project.stale;
}

function progressOf(project: Project, points: boolean): number {
  const scope = points ? project.scopePoints : project.scopeIssues;
  const completed = points ? project.completedPoints : project.completedIssues;
  return scope === 0 ? 0 : Math.min(100, (completed / scope) * 100);
}

function projectRows(projects: readonly Project[], points: boolean): AnalyticsDataRow[] {
  return projects.map((project) => {
    const scope = points ? project.scopePoints : project.scopeIssues;
    const completed = points ? project.completedPoints : project.completedIssues;
    return {
      id: project.id,
      label: `${completed} of ${scope} ${points ? 'points' : 'issues'}, ${riskOf(project)} risks`,
      cells: {
        project: project.name,
        health: healthLabels[project.health],
        progress: `${completed} / ${scope}`,
        milestone: project.nextMilestoneName ?? 'No milestone',
        target: project.targetDate ?? 'No target',
        risk: riskOf(project),
      },
    };
  });
}

function sortedProjects(projects: readonly Project[], sort: ProjectSort): Project[] {
  return projects.toSorted((left, right) => {
    if (sort === 'risk') return riskOf(right) - riskOf(left) || left.name.localeCompare(right.name);
    if (sort === 'target') {
      return (
        (left.targetDate ?? '9999-12-31').localeCompare(right.targetDate ?? '9999-12-31') ||
        left.name.localeCompare(right.name)
      );
    }
    return left.name.localeCompare(right.name);
  });
}

function ProjectPortfolio({
  data,
  points,
  onFocusProject,
}: {
  readonly data: AnalyticsProjectsResponse;
  readonly points: boolean;
  readonly onFocusProject: (projectId: string) => void;
}) {
  const [sort, setSort] = useState<ProjectSort>('name');
  const projects = sortedProjects(data.projects, sort);
  const unit = points ? 'points' : 'issues';
  return (
    <AnalyticsCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm text-text">Project portfolio</h2>
          <p className="mt-1 text-muted text-xs">
            Scope, progress, health, milestones, and delivery risk.
          </p>
        </div>
        <label className="flex items-center gap-2 text-muted text-xs">
          Sort projects
          <select
            aria-label="Sort projects"
            className="rounded-md border border-border bg-surface px-2 py-1 text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onChange={(event) => setSort(event.target.value as ProjectSort)}
            value={sort}
          >
            <option value="name">Name</option>
            <option value="risk">Risk</option>
            <option value="target">Target date</option>
          </select>
        </label>
      </div>
      {projects.length === 0 ? (
        <p className="py-10 text-center text-muted text-sm">No projects match this view.</p>
      ) : (
        <AnalyticsDataTable
          ariaLabel="Project portfolio"
          columns={[
            { id: 'project', label: 'Project' },
            { id: 'health', label: 'Health' },
            { id: 'progress', label: `Completed ${unit}`, align: 'right' },
            { id: 'milestone', label: 'Next milestone' },
            { id: 'target', label: 'Target' },
            { id: 'risk', label: 'Risks', align: 'right' },
          ]}
          onActivate={(row) => onFocusProject(row.id)}
          rows={projectRows(projects, points)}
        />
      )}
      {data.truncated ? (
        <p className="text-faint text-xs">Showing 100 of {data.totalProjects} projects.</p>
      ) : null}
    </AnalyticsCard>
  );
}

function ProjectHealthUpdates({
  updates,
}: {
  readonly updates: NonNullable<AnalyticsProjectsResponse['focused']>['healthUpdates'];
}) {
  return (
    <AnalyticsCard title="Latest project updates">
      {updates.length === 0 ? (
        <p className="py-8 text-center text-muted text-xs">No project updates yet.</p>
      ) : (
        <ol className="grid gap-3">
          {updates.map((update) => (
            <li className="rounded-md border border-border bg-surface-2 p-3" key={update.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-xs text-text">{healthLabels[update.health]}</span>
                <time className="text-faint text-2xs" dateTime={update.createdAt}>
                  {update.createdAt.slice(0, 10)}
                </time>
              </div>
              <p className="mt-2 text-muted text-xs">{update.body}</p>
              <p className="mt-2 text-faint text-2xs">Updated by {update.author.name}</p>
            </li>
          ))}
        </ol>
      )}
    </AnalyticsCard>
  );
}

export function ProjectsLens({
  data,
  query,
  onFocusProject,
}: {
  readonly data: AnalyticsProjectsResponse;
  readonly query: AnalyticsQuery;
  readonly onFocusProject: (projectId: string) => void;
}) {
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const points = query.measure === 'points';
  const unit = points ? 'points' : 'issues';
  const focused = data.focused;
  const activate = (title: string, cohort: AnalyticsDrilldownCohort) =>
    setEvidence({ title, cohort });

  return (
    <div className="grid gap-4">
      <ProjectPortfolio data={data} onFocusProject={onFocusProject} points={points} />

      {focused === null ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-muted text-sm">
          Select a project to inspect milestones, scope, and delivery evidence.
        </p>
      ) : (
        <div className="grid gap-4">
          <AnalyticsCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-muted text-xs">Focused project</p>
                <h2 className="mt-1 font-medium text-base text-text">{focused.project.name}</h2>
                <p className="mt-1 text-faint text-xs">
                  {focused.project.teams.map((team) => team.name).join(', ') || 'Workspace'}
                </p>
              </div>
              <span className="rounded-full bg-surface-2 px-2 py-1 text-muted text-xs">
                {healthLabels[focused.project.health]}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div>
                <p className="font-semibold text-xl text-text">
                  {points ? focused.project.scopePoints : focused.project.scopeIssues}
                </p>
                <p className="text-faint text-xs">Current scope</p>
              </div>
              <div>
                <p className="font-semibold text-xl text-text">
                  {points ? focused.project.completedPoints : focused.project.completedIssues}
                </p>
                <p className="text-faint text-xs">Completed</p>
              </div>
              {[
                ['Blocked', focused.project.blocked, focused.project.cohorts.blocked],
                ['Overdue', focused.project.overdue, focused.project.cohorts.overdue],
                ['Stale', focused.project.stale, focused.project.cohorts.stale],
              ].map(([label, value, cohort]) => (
                <button
                  className="rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  key={String(label)}
                  onClick={() => activate(String(label), cohort as AnalyticsDrilldownCohort)}
                  type="button"
                >
                  <span className="block font-semibold text-xl text-text">{String(value)}</span>
                  <span className="text-faint text-xs">{String(label)}</span>
                </button>
              ))}
            </div>
            <div>
              <div className="mb-1 flex justify-between text-faint text-xs">
                <span>Progress</span>
                <span>{progressOf(focused.project, points).toFixed(0)}%</span>
              </div>
              <progress
                aria-label={`${focused.project.name} progress`}
                className="h-1.5 w-full accent-accent"
                max={100}
                value={progressOf(focused.project, points)}
              />
            </div>
            {points && focused.project.unestimated > 0 ? (
              <p className="text-muted text-xs">{unestimatedNote(focused.project.unestimated)}</p>
            ) : null}
          </AnalyticsCard>

          <AnalyticsCard title="Delivery and scope">
            {focused.delivery.length === 0 ? (
              <p className="py-8 text-center text-muted text-xs">No delivery activity yet.</p>
            ) : (
              <LinePlot
                label={`${focused.project.name} delivery`}
                onActivate={(cohort) => activate('Project delivery evidence', cohort)}
                series={[
                  {
                    id: 'scope',
                    label: 'Scope',
                    points: focused.delivery.map((point) => ({
                      id: `${point.date}-scope`,
                      label: point.date,
                      value: point.scope,
                      cohort: point.scopeCohort,
                    })),
                  },
                  {
                    id: 'completed',
                    label: 'Completed',
                    points: focused.delivery.map((point) => ({
                      id: `${point.date}-completed`,
                      label: point.date,
                      value: point.completed,
                      cohort: point.completedCohort,
                    })),
                  },
                  {
                    id: 'open',
                    label: 'Open',
                    points: focused.delivery.map((point) => ({
                      id: `${point.date}-open`,
                      label: point.date,
                      value: point.open,
                      cohort: point.openCohort,
                    })),
                  },
                ]}
                xAxisLabel="Reporting period"
                yAxisLabel={points ? 'Points' : 'Issues'}
              />
            )}
          </AnalyticsCard>

          <AnalyticsCard title="Milestones">
            {focused.milestones.length === 0 ? (
              <p className="py-8 text-center text-muted text-xs">No milestones yet.</p>
            ) : (
              <AnalyticsDataTable
                ariaLabel={`${focused.project.name} milestones`}
                columns={[
                  { id: 'milestone', label: 'Milestone' },
                  { id: 'target', label: 'Target' },
                  { id: 'progress', label: 'Progress', align: 'right' },
                ]}
                onActivate={(row) => {
                  const milestone = focused.milestones.find((item) => item.id === row.id);
                  if (milestone !== undefined) activate(milestone.name, milestone.currentCohort);
                }}
                rows={focused.milestones.map((milestone) => {
                  const completed = points ? milestone.completedPoints : milestone.completedIssues;
                  const scope = points ? milestone.scopePoints : milestone.scopeIssues;
                  return {
                    id: milestone.id,
                    label: `${completed} / ${scope} ${unit}`,
                    cells: {
                      milestone: milestone.name,
                      target: milestone.targetDate ?? 'No target',
                      progress: `${completed} / ${scope} ${unit}`,
                    },
                  };
                })}
              />
            )}
          </AnalyticsCard>
          <ProjectHealthUpdates updates={focused.healthUpdates} />
        </div>
      )}

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
