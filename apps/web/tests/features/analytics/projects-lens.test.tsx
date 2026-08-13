import { describe, expect, mock, test } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import type { AnalyticsProjectsResponse } from '../../../src/features/analytics/contracts.ts';
import { ProjectsLens } from '../../../src/features/analytics/projects-lens.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const projectId = '00000000-0000-7000-8000-000000000001';
const secondProjectId = '00000000-0000-7000-8000-000000000002';
const milestoneId = '00000000-0000-7000-8000-000000000003';
const asOf = '2026-08-14T10:00:00.000Z';
const cohort = (name: string, id = projectId) => ({ cohort: `${name}:${id}` });
const row = (id: string, name: string, blocked: number) => ({
  id,
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  status: 'in_progress' as const,
  health: blocked > 1 ? ('at_risk' as const) : ('on_track' as const),
  healthSource: 'manual' as const,
  archived: false,
  lead: null,
  teams: [{ id: '00000000-0000-7000-8000-000000000010', key: 'ENG', name: 'Engineering' }],
  startDate: '2026-08-01',
  targetDate: '2026-08-31',
  scopeIssues: 10,
  scopePoints: 25,
  openIssues: 6,
  openPoints: 15,
  wipIssues: 3,
  wipPoints: 8,
  completedIssues: 4,
  completedPoints: 10,
  blocked,
  overdue: 1,
  stale: 2,
  unestimated: 1,
  scopeAddedIssues: 2,
  scopeAddedPoints: 5,
  scopeAddedCoverage: 'captured' as const,
  completedInRangeIssues: 3,
  completedInRangePoints: 8,
  estimateCoverage: 'mixed' as const,
  nextMilestoneId: milestoneId,
  nextMilestoneName: 'Public beta',
  nextMilestoneTargetDate: '2026-08-20',
  cohorts: {
    current: cohort('project-current', id),
    open: cohort('project-open', id),
    completed: cohort('project-completed', id),
    blocked: cohort('project-blocked', id),
    overdue: cohort('project-overdue', id),
    stale: cohort('project-stale', id),
    unestimated: cohort('project-unestimated', id),
    scopeAdded: cohort('project-added', id),
    completedInRange: cohort('project-range', id),
  },
});

const platform = row(projectId, 'Platform migration', 3);
const data: AnalyticsProjectsResponse = {
  lens: 'projects',
  asOf,
  projects: [row(secondProjectId, 'API cleanup', 0), platform],
  totalProjects: 2,
  truncated: false,
  focused: {
    project: platform,
    delivery: [
      {
        date: '2026-08-14',
        scope: 25,
        started: 8,
        completed: 10,
        open: 15,
        added: 5,
        completedInBucket: 3,
        scopeCohort: cohort('project-scope'),
        startedCohort: cohort('project-started'),
        completedCohort: cohort('project-completed'),
        openCohort: cohort('project-open'),
        addedCohort: cohort('project-added'),
        completedInBucketCohort: cohort('project-bucket'),
      },
    ],
    milestones: [
      {
        id: milestoneId,
        name: 'Public beta',
        targetDate: '2026-08-20',
        scopeIssues: 5,
        scopePoints: 13,
        completedIssues: 2,
        completedPoints: 5,
        progressIssues: 40,
        progressPoints: 38.5,
        currentCohort: { cohort: `milestone-current:${milestoneId}` },
        completedCohort: { cohort: `milestone-completed:${milestoneId}` },
      },
    ],
    totalMilestones: 1,
    milestonesTruncated: false,
    healthUpdates: [
      {
        id: '00000000-0000-7000-8000-000000000004',
        health: 'at_risk',
        body: 'API migration is waiting on the billing cutover.',
        createdAt: '2026-08-13T10:00:00.000Z',
        author: { id: '00000000-0000-7000-8000-000000000005', name: 'Grace Hopper' },
      },
    ],
  },
  coverage: { kind: 'captured', from: '2026-08-01T00:00:00.000Z', asOf },
};

describe('ProjectsLens', () => {
  test('keeps portfolio selection in analytics and exposes focused planning evidence', async () => {
    const onFocus = mock();
    const user = userEvent.setup();
    render(
      <ProjectsLens
        data={data}
        onFocusProject={onFocus}
        query={analyticsQuerySchema.parse({ lens: 'projects', measure: 'points' })}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Sort projects'), 'risk');
    expect(screen.getByRole('button', { name: /Platform migration/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /API cleanup/ }));
    expect(onFocus).toHaveBeenCalledWith(secondProjectId);
    expect(screen.getByRole('heading', { name: 'Platform migration' })).toBeVisible();
    expect(screen.getAllByText('At risk').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Public beta').length).toBeGreaterThan(0);
    expect(screen.getByText('5 / 13 points')).toBeVisible();
    expect(screen.getByText(/1 unestimated issue contributes zero points/i)).toBeVisible();
    expect(screen.getByRole('application', { name: 'Platform migration delivery' })).toBeVisible();
    expect(screen.getByText('API migration is waiting on the billing cutover.')).toBeVisible();
    expect(screen.getByText(/Grace Hopper/)).toBeVisible();
  });
});
