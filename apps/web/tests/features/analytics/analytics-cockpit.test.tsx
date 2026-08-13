import { describe, expect, it } from 'bun:test';
import type { SavedAnalyticsViewPayload } from '@orbit/core';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '../../../src/components/ui/toast.tsx';
import { AnalyticsCockpit } from '../../../src/features/analytics/analytics-cockpit.tsx';
import { analyticsKeys } from '../../../src/features/analytics/analytics-keys.ts';
import type {
  AnalyticsOverviewResponse,
  AnalyticsPeopleResponse,
  AnalyticsProjectsResponse,
  AnalyticsSprintsResponse,
} from '../../../src/features/analytics/contracts.ts';
import { createQueryClient } from '../../../src/lib/query/provider.tsx';

const asOf = '2026-08-13T12:00:00.000Z';
const overview: AnalyticsOverviewResponse = {
  lens: 'overview',
  asOf,
  coverage: { kind: 'live', from: null, asOf },
  cards: [
    {
      id: 'throughput',
      label: 'Completed',
      value: 18,
      unit: 'issues',
      comparisonDelta: 3,
      cohort: { cohort: 'completed' },
      reconciliation: { kind: 'total', cohortCount: 18 },
    },
  ],
  delivery: [],
  state: [],
  projects: [],
  priorities: [],
  outliers: [],
};

const projectId = '00000000-0000-7000-8000-000000000001';
const personId = '00000000-0000-7000-8000-000000000002';
const projectCohort = (name: string) => ({ cohort: `${name}:${projectId}` });
const personCohort = (name: string) => ({ cohort: `${name}:${personId}` });

const projects: AnalyticsProjectsResponse = {
  lens: 'projects',
  asOf,
  projects: [
    {
      id: projectId,
      name: 'Platform',
      slug: 'platform',
      status: 'in_progress',
      health: 'on_track',
      healthSource: 'manual',
      archived: false,
      lead: null,
      teams: [],
      startDate: null,
      targetDate: null,
      scopeIssues: 13,
      scopePoints: 34,
      openIssues: 8,
      openPoints: 21,
      wipIssues: 3,
      wipPoints: 8,
      completedIssues: 5,
      completedPoints: 13,
      blocked: 1,
      overdue: 0,
      stale: 0,
      unestimated: 0,
      scopeAddedIssues: 0,
      scopeAddedPoints: 0,
      scopeAddedCoverage: 'captured',
      completedInRangeIssues: 5,
      completedInRangePoints: 13,
      estimateCoverage: 'complete',
      nextMilestoneId: null,
      nextMilestoneName: null,
      nextMilestoneTargetDate: null,
      cohorts: {
        current: projectCohort('project-current'),
        open: projectCohort('project-open'),
        completed: projectCohort('project-completed'),
        blocked: projectCohort('project-blocked'),
        overdue: projectCohort('project-overdue'),
        stale: projectCohort('project-stale'),
        unestimated: projectCohort('project-unestimated'),
        scopeAdded: projectCohort('project-added'),
        completedInRange: projectCohort('project-range'),
      },
    },
  ],
  totalProjects: 1,
  truncated: false,
  focused: null,
  coverage: { kind: 'live', from: null, asOf },
};

const person = {
  person: {
    id: personId,
    name: 'Ada',
    image: null,
    currentMember: true,
    status: 'current' as const,
  },
  currentAssignments: 3,
  currentPoints: 8,
  completedIssues: 2,
  completedPoints: 5,
  activeWeeks: 1,
  averageThroughputIssues: 2,
  averageThroughputPoints: 5,
  cycleTime: { valid: 2, p50: 1, p85: 2 },
  leadTime: { valid: 2, p50: 2, p85: 3 },
  currentWip: 2,
  currentWipPoints: 5,
  wipAge: { valid: 2, p50: 1, p85: 2 },
  blocked: 0,
  overdue: 0,
  stale: 0,
  unestimated: 0,
  currentProjects: 1,
  currentMilestones: 1,
  currentSprints: 1,
  attribution: { captured: 2, reconstructed: 0, currentAssignee: 0, kind: 'captured' as const },
  cohorts: {
    currentAssignments: personCohort('person-current'),
    completed: personCohort('person-completed'),
    wip: personCohort('person-wip'),
    blocked: personCohort('person-blocked'),
    overdue: personCohort('person-overdue'),
    stale: personCohort('person-stale'),
    unestimated: personCohort('person-unestimated'),
  },
};

const people: AnalyticsPeopleResponse = {
  lens: 'people',
  asOf,
  people: [person],
  totalPeople: 1,
  truncated: false,
  focused: {
    ...person,
    projects: [],
    milestones: [],
    sprints: [],
    states: [],
    timeline: [],
    sprintBurn: { selected: null, current: null, previous: null },
  },
  coverage: { kind: 'live', from: null, asOf },
  formulas: {
    currentAssignments: 'Current open assignments.',
    completed: 'Completed in range.',
    activeWeek: 'Weeks with assignment activity.',
    cycleTime: 'Start to completion.',
    leadTime: 'Creation to completion.',
    wipAge: 'Age of current WIP.',
    attribution: 'Historical assignee at completion.',
    points: 'Unestimated is zero points.',
  },
};

const emptySprints: AnalyticsSprintsResponse = {
  lens: 'sprints',
  selected: null,
  current: null,
  previous: null,
  velocity: [],
  flow: {
    leadTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
    cycleTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
    completed: 0,
    leadTimeCoverage: 'unavailable',
    cycleTimeCoverage: 'unavailable',
  },
  focus: null,
  coverage: { kind: 'live', from: null, asOf },
  formulas: {
    planned: 'Captured at sprint start.',
    scope: 'Membership during the sprint.',
    burn: 'Remaining scope by local day.',
    leadTime: 'Creation to completion.',
    cycleTime: 'Start to completion.',
    points: 'Unestimated work is zero points.',
    coverage: 'Live when no sprint is selected.',
  },
};

function renderCockpit(
  query = analyticsQuerySchema.parse({}),
  response:
    | AnalyticsOverviewResponse
    | AnalyticsSprintsResponse
    | AnalyticsProjectsResponse
    | AnalyticsPeopleResponse = overview,
  savedViews: readonly SavedAnalyticsViewPayload[] = [],
) {
  const client = createQueryClient();
  client.setQueryDefaults(analyticsKeys.root, { enabled: false });
  client.setQueryData(analyticsKeys.lens(query.lens, query), response);
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return render(<AnalyticsCockpit initialQuery={query} savedViews={savedViews} />, {
    wrapper: Wrapper,
  });
}

describe('AnalyticsCockpit', () => {
  it('renders useful hydrated metrics without asking for configuration', () => {
    renderCockpit();

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Reporting range/ })).toHaveTextContent(
      'Active sprint or last 30 days',
    );
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText('18')).toBeVisible();
    expect(screen.queryByText('Analytics data is ready.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a dataset')).not.toBeInTheDocument();
  });

  it('moves between tabs with arrow, Home, and End keys and updates the URL', async () => {
    const user = userEvent.setup();
    renderCockpit();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    overviewTab.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Sprints' })).toHaveFocus();
    expect(window.location.search).toContain('lens=sprints');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'People' })).toHaveFocus();
    expect(window.location.search).toContain('lens=people');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    expect(window.location.search).toBe('');
  });

  it('validates a custom range before applying it and can reset the view', async () => {
    const user = userEvent.setup();
    renderCockpit();

    await user.click(screen.getByRole('button', { name: /Reporting range/ }));
    await user.click(screen.getByRole('button', { name: 'Custom range' }));
    const start = screen.getByLabelText('Start date');
    const end = screen.getByLabelText('End date');
    await user.clear(start);
    await user.type(start, '2026-08-12');
    await user.clear(end);
    await user.type(end, '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    expect(screen.getByRole('alert')).toHaveTextContent('End date must be on or after start date');
    expect(window.location.search).toBe('');

    await user.clear(end);
    await user.type(end, '2026-08-13');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(window.location.search).toContain('range=custom');
    expect(window.location.search).toContain('from=2026-08-12');

    await user.click(screen.getByRole('button', { name: 'Reset analytics' }));
    expect(window.location.search).toBe('');
  });

  it('renders an honest first-sprint empty state', () => {
    const query = analyticsQuerySchema.parse({ lens: 'sprints' });
    renderCockpit(query, emptySprints);

    expect(screen.getByRole('heading', { name: 'No sprint history yet' })).toBeVisible();
    expect(screen.getByText(/burn and comparison charts will appear/)).toBeVisible();
  });

  it('uses points consistently in project and people lenses', () => {
    const projectQuery = analyticsQuerySchema.parse({ lens: 'projects', measure: 'points' });
    const projectView = renderCockpit(projectQuery, projects);
    expect(screen.getByText('13 / 34')).toBeVisible();
    projectView.unmount();

    const peopleQuery = analyticsQuerySchema.parse({ lens: 'people', measure: 'points' });
    renderCockpit(peopleQuery, people);
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
  });

  it('keeps project and person selection inside analytics URL state', async () => {
    const user = userEvent.setup();
    const projectQuery = analyticsQuerySchema.parse({ lens: 'projects' });
    const projectView = renderCockpit(projectQuery, projects);
    await user.click(screen.getByRole('button', { name: /Platform, 5 of 13 issues/ }));
    expect(window.location.search).toContain(`projectId=${projectId}`);
    expect(window.location.search).toContain('lens=projects');
    projectView.unmount();

    const peopleQuery = analyticsQuerySchema.parse({ lens: 'people' });
    renderCockpit(peopleQuery, people);
    await user.click(screen.getByRole('button', { name: /Ada, 3 assigned, 2 completed/ }));
    expect(window.location.search).toContain(`personId=${personId}`);
    expect(window.location.search).toContain('lens=people');
  });

  it('sums delivery buckets across the selected period', () => {
    renderCockpit(undefined, {
      ...overview,
      delivery: [
        {
          date: '2026-08-12',
          created: 4,
          completed: 2,
          open: 9,
          createdCohort: { cohort: 'created', bucket: '2026-08-12' },
          completedCohort: { cohort: 'completed', bucket: '2026-08-12' },
          openCohort: { cohort: 'open', bucket: '2026-08-12' },
        },
        {
          date: '2026-08-13',
          created: 3,
          completed: 5,
          open: 7,
          createdCohort: { cohort: 'created', bucket: '2026-08-13' },
          completedCohort: { cohort: 'completed', bucket: '2026-08-13' },
          openCohort: { cohort: 'open', bucket: '2026-08-13' },
        },
      ],
    });

    expect(screen.getByTestId('delivery-created')).toHaveTextContent('7');
    expect(screen.getByTestId('delivery-completed')).toHaveTextContent('7');
    expect(screen.getByTestId('delivery-open')).toHaveTextContent('7');
  });

  it('shows active filters and offers the shared searchable filter menu', async () => {
    const user = userEvent.setup();
    const query = analyticsQuerySchema.parse({
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'project',
            operator: 'in',
            values: [projectId],
            negate: false,
          },
        ],
      },
    });
    renderCockpit(query, overview);

    expect(screen.getByText(`Project is ${projectId}`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(screen.getByLabelText('Search filters')).toBeVisible();
    expect(screen.getByTestId('filter-field-assignee')).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('button', { name: `Remove filter: Project is ${projectId}` }),
    );
    expect(window.location.search).toBe('');
  });

  it('describes and removes a nested negated filter without changing its siblings', async () => {
    const user = userEvent.setup();
    const query = analyticsQuerySchema.parse({
      filter: {
        kind: 'group',
        combinator: 'or',
        children: [
          {
            kind: 'group',
            combinator: 'and',
            children: [
              {
                kind: 'condition',
                property: 'project',
                operator: 'in',
                values: [projectId],
                negate: true,
              },
            ],
          },
          {
            kind: 'condition',
            property: 'priority',
            operator: 'in',
            values: ['1'],
            negate: false,
          },
        ],
      },
    });
    renderCockpit(query, overview);

    expect(screen.getByText(`Project is not ${projectId}`)).toBeVisible();
    expect(screen.getByText('Priority is Urgent')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: `Remove filter: Project is not ${projectId}` }),
    );

    expect(window.location.search).toContain('priority');
    expect(window.location.search).not.toContain(projectId);
  });

  it('renders explicit boundaries for sibling Boolean groups', () => {
    const condition = (property: 'project' | 'priority', value: string) => ({
      kind: 'condition' as const,
      property,
      operator: 'in' as const,
      values: [value],
      negate: false,
    });
    const query = analyticsQuerySchema.parse({
      filter: {
        kind: 'group',
        combinator: 'or',
        children: [
          {
            kind: 'group',
            combinator: 'and',
            children: [condition('project', projectId), condition('priority', '1')],
          },
          {
            kind: 'group',
            combinator: 'and',
            children: [condition('project', `${projectId.slice(0, -1)}3`)],
          },
        ],
      },
    });
    renderCockpit(query, overview);

    const firstGroup = screen.getByTestId('filter-group-0');
    const secondGroup = screen.getByTestId('filter-group-1');
    expect(firstGroup).toHaveAccessibleName('Match all filter group');
    expect(secondGroup).toHaveAccessibleName('Match all filter group');
    expect(within(firstGroup).getByText('Priority is Urgent')).toBeVisible();
    expect(within(secondGroup).queryByText('Priority is Urgent')).not.toBeInTheDocument();
  });

  it('uses selected-person copy for explicit focus and links tabs to their panel', () => {
    const query = analyticsQuerySchema.parse({ lens: 'people', focus: { personId } });
    renderCockpit(query, people);

    expect(screen.getByText('Selected person')).toBeVisible();
    const tab = screen.getByRole('tab', { name: 'People' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    for (const lens of ['overview', 'sprints', 'projects', 'people']) {
      expect(document.getElementById(`analytics-panel-${lens}`)).not.toBeNull();
    }
  });

  it('does not call a person selected by an assignee filter My work', () => {
    const query = analyticsQuerySchema.parse({
      lens: 'people',
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'assignee',
            operator: 'in',
            values: [personId],
            negate: false,
          },
        ],
      },
    });
    renderCockpit(query, people);

    expect(screen.getByText('Selected person')).toBeVisible();
    expect(screen.queryByText('My work')).not.toBeInTheDocument();
  });

  it('restores a complete saved analytics query', async () => {
    const user = userEvent.setup();
    const savedQuery = analyticsQuerySchema.parse({
      lens: 'people',
      range: { preset: 'last_90_days' },
      compare: 'previous_period',
      measure: 'points',
      includeArchived: true,
      focus: { personId },
    });
    renderCockpit(undefined, overview, [
      {
        id: 'saved_1',
        name: 'My quarter',
        scopeType: 'workspace',
        scopeId: null,
        kind: 'dashboard',
        config: { kind: 'dashboard', version: 1, query: savedQuery, pinned: true },
        shared: false,
        ownerId: personId,
        createdAt: asOf,
        updatedAt: asOf,
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'My quarter' }));

    expect(window.location.search).toContain('lens=people');
    expect(window.location.search).toContain('range=last_90_days');
    expect(window.location.search).toContain('compare=previous_period');
    expect(window.location.search).toContain('measure=points');
    expect(window.location.search).toContain('includeArchived=1');
    expect(window.location.search).toContain(`personId=${personId}`);
  });
});
