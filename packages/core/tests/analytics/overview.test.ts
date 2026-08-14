import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { type AnalyticsQuery, analyticsQuerySchema } from '@orbit/shared';
import type { Principal } from '@orbit/shared/policy';
import { listAnalyticsDrilldown } from '../../src/analytics/drilldown.ts';
import { loadAnalyticsOverview } from '../../src/analytics/overview.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { archiveIssue, createIssue, setRelation } from '../../src/work/issue-service.ts';
import { createProject } from '../../src/work/project-service.ts';

const now = new Date('2026-08-13T12:00:00.000Z');

let workspace: Workspace;

function query(measure: 'issues' | 'points' = 'issues'): AnalyticsQuery {
  return analyticsQuerySchema.parse({
    range: { preset: 'custom', from: '2026-08-01', to: '2026-08-10' },
    compare: 'previous_period',
    measure,
  });
}

async function issue(
  principal: Principal,
  input: {
    readonly teamId?: string;
    readonly title: string;
    readonly stateId?: string;
    readonly projectId?: string;
    readonly estimate?: number | null;
    readonly priority?: number;
    readonly dueDate?: Date | null;
  },
  timestamps: {
    readonly createdAt: Date;
    readonly updatedAt?: Date;
    readonly startedAt?: Date | null;
    readonly completedAt?: Date | null;
    readonly stateEnteredAt?: Date;
  },
): Promise<string> {
  const created = await createIssue(principal, {
    teamId: input.teamId ?? workspace.teamId,
    title: input.title,
    stateId: input.stateId,
    projectId: input.projectId,
    estimate: input.estimate,
    priority: input.priority,
    dueDate: input.dueDate,
  });
  await db
    .update(schema.issue)
    .set({
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt ?? timestamps.createdAt,
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      stateEnteredAt: timestamps.stateEnteredAt ?? timestamps.updatedAt ?? timestamps.createdAt,
    })
    .where(eq(schema.issue.id, created.issue.id));
  return created.issue.id;
}

function card(overview: Awaited<ReturnType<typeof loadAnalyticsOverview>>, id: string) {
  const found = overview.cards.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Missing ${id} card.`);
  return found;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('loadAnalyticsOverview', () => {
  it('groups workflow states by semantic category across teams', async () => {
    const secondTeam = await createTeam(workspace.admin, { name: 'Second team', key: 'SEC' });
    const firstBacklog = stateNamed(workspace, 'Backlog');
    const [secondBacklog] = await db
      .select()
      .from(schema.workflowState)
      .where(
        and(
          eq(schema.workflowState.teamId, secondTeam.team.id),
          eq(schema.workflowState.category, 'backlog'),
        ),
      )
      .limit(1);
    if (secondBacklog === undefined) throw new Error('Missing second-team backlog state.');
    await issue(
      workspace.admin,
      { title: 'First backlog', stateId: firstBacklog.id },
      { createdAt: new Date('2026-08-01T00:00:00.000Z') },
    );
    await issue(
      workspace.admin,
      {
        title: 'Second backlog',
        teamId: secondTeam.team.id,
        stateId: secondBacklog.id,
      },
      { createdAt: new Date('2026-08-01T00:00:00.000Z') },
    );

    const overview = await loadAnalyticsOverview(workspace.admin, query(), {
      now,
      timezone: 'UTC',
    });
    const backlog = overview.state.filter((bucket) => bucket.label === 'Backlog');

    expect(backlog).toHaveLength(1);
    expect(backlog[0]?.id).toBe('backlog');
    expect(backlog[0]?.value).toBe(2);
    expect(backlog[0]?.cohort).toEqual({ cohort: 'state-category:backlog' });
    const drilldown = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: backlog[0]?.cohort ?? { cohort: 'invalid' } },
      { now, timezone: 'UTC' },
    );
    expect(drilldown.total).toBe(2);
  });

  it('evaluates named and relative date filters in the reporting timezone', async () => {
    await issue(
      workspace.admin,
      { title: 'New York today' },
      { createdAt: new Date('2026-08-02T01:00:00.000Z') },
    );
    await issue(
      workspace.admin,
      { title: 'New York tomorrow' },
      { createdAt: new Date('2026-08-02T05:00:00.000Z') },
    );
    const todayQuery = analyticsQuerySchema.parse({
      ...query(),
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'created',
            operator: 'in',
            values: ['today'],
            negate: false,
          },
        ],
      },
    });
    const relativeQuery = analyticsQuerySchema.parse({
      ...query(),
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'created',
            operator: 'relative',
            relative: { unit: 'day', offset: 1, direction: 'past' },
            negate: false,
          },
        ],
      },
    });
    const context = {
      now: new Date('2026-08-02T02:00:00.000Z'),
      timezone: 'America/New_York',
      cursorSecret: 'analytics-test-secret',
    };

    for (const filteredQuery of [todayQuery, relativeQuery]) {
      const overview = await loadAnalyticsOverview(workspace.admin, filteredQuery, context);
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        { query: filteredQuery, cohort: { cohort: 'current' } },
        context,
      );
      expect(overview.state.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(1);
      expect(drilldown.issues.map((entry) => entry.title)).toEqual(['New York today']);
    }
  });

  it('reconciles current and interval cards with semantic drilldowns', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const started = stateNamed(workspace, 'In Progress');
    const done = stateNamed(workspace, 'Done');
    const first = await issue(
      workspace.admin,
      {
        title: 'Blocked stale overdue work',
        stateId: started.id,
        estimate: null,
        priority: 1,
        dueDate: new Date('2026-08-12T00:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-20T00:00:00.000Z'),
        startedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    );
    const blocker = await issue(
      workspace.admin,
      { title: 'Blocker', stateId: todo.id, estimate: 2 },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    await setRelation(workspace.admin, blocker, { relatedIssueId: first, type: 'blocks' });
    await issue(
      workspace.admin,
      { title: 'Fast completion', stateId: done.id, estimate: 3, priority: 2 },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-03T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    );
    await issue(
      workspace.admin,
      { title: 'Slow completion', stateId: done.id, estimate: 5, priority: 3 },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-09T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    );

    const overview = await loadAnalyticsOverview(workspace.admin, query(), {
      now,
      timezone: 'UTC',
    });

    expect(card(overview, 'wip').value).toBe(1);
    expect(card(overview, 'blocked').value).toBe(1);
    expect(card(overview, 'overdue').value).toBe(1);
    expect(card(overview, 'stale').value).toBe(1);
    expect(card(overview, 'unestimated').value).toBe(1);
    expect(card(overview, 'throughput').value).toBe(2);
    expect(card(overview, 'cycle_time_p50').value).toBe(4);
    expect(card(overview, 'cycle_time_p85').value).toBeCloseTo(6.1, 5);
    expect(overview.delivery).toHaveLength(10);
    expect(overview.state.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(4);
    expect(overview.priorities.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(4);

    for (const metric of overview.cards) {
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query(),
          cohort: metric.cohort,
          limit: 100,
        },
        { now, timezone: 'UTC' },
      );
      expect(drilldown.total).toBe(metric.reconciliation.cohortCount);
      if (metric.reconciliation.kind === 'total') {
        expect(metric.value).toBe(drilldown.totalValue);
      } else {
        const detail = drilldown.details[metric.reconciliation.detail];
        if (detail === null) throw new Error('Missing cycle time detail.');
        expect(metric.value).toBe(detail);
      }
    }
    for (const bucket of [...overview.state, ...overview.projects, ...overview.priorities]) {
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query(),
          cohort: bucket.cohort,
          limit: 100,
        },
        { now, timezone: 'UTC' },
      );
      expect(drilldown.totalValue).toBe(bucket.value);
    }
    for (const point of overview.delivery) {
      for (const [cohort, value] of [
        [point.createdCohort, point.created],
        [point.completedCohort, point.completed],
        [point.openCohort, point.open],
      ] as const) {
        const drilldown = await listAnalyticsDrilldown(
          workspace.admin,
          {
            query: query(),
            cohort,
            limit: 100,
          },
          { now, timezone: 'UTC' },
        );
        expect(drilldown.totalValue).toBe(value);
      }
    }
    for (const outlier of overview.outliers) {
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query(),
          cohort: outlier.cohort,
          limit: 100,
        },
        { now, timezone: 'UTC' },
      );
      expect(drilldown.issues.map((entry) => entry.id)).toEqual([outlier.issueId]);
    }
  });

  it('uses points without hiding unestimated work and computes comparison deltas', async () => {
    const done = stateNamed(workspace, 'Done');
    const todo = stateNamed(workspace, 'Todo');
    await issue(
      workspace.admin,
      { title: 'Current five points', stateId: done.id, estimate: 5 },
      {
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
        startedAt: new Date('2026-08-03T00:00:00.000Z'),
        completedAt: new Date('2026-08-05T00:00:00.000Z'),
      },
    );
    await issue(
      workspace.admin,
      { title: 'Previous two points', stateId: done.id, estimate: 2 },
      {
        createdAt: new Date('2026-07-25T00:00:00.000Z'),
        startedAt: new Date('2026-07-26T00:00:00.000Z'),
        completedAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    );
    await issue(
      workspace.admin,
      { title: 'Unestimated open', stateId: todo.id, estimate: null },
      { createdAt: new Date('2026-08-04T00:00:00.000Z') },
    );

    const overview = await loadAnalyticsOverview(workspace.admin, query('points'), {
      now,
      timezone: 'UTC',
    });

    expect(card(overview, 'throughput')).toMatchObject({
      value: 5,
      unit: 'points',
      comparisonDelta: 3,
    });
    expect(card(overview, 'unestimated')).toMatchObject({ value: 1, unit: 'issues' });
  });

  it('bounds project distribution and reconciles the Other cohort', async () => {
    for (let index = 0; index < 10; index += 1) {
      const { project } = await createProject(workspace.admin, {
        name: `Project ${String(index).padStart(2, '0')}`,
        teamIds: [workspace.teamId],
      });
      await issue(
        workspace.admin,
        { title: `Issue ${index}`, projectId: project.id },
        { createdAt: new Date('2026-08-02T00:00:00.000Z') },
      );
    }
    const overview = await loadAnalyticsOverview(workspace.admin, query(), {
      now,
      timezone: 'UTC',
    });
    const other = overview.projects.find((bucket) => bucket.label === 'Other');
    if (other === undefined) throw new Error('Missing Other project bucket.');
    const drilldown = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: other.cohort, limit: 100 },
      { now, timezone: 'UTC', cursorSecret: 'analytics-test-secret' },
    );

    expect(overview.projects).toHaveLength(9);
    expect(other.value).toBe(2);
    expect(drilldown.totalValue).toBe(other.value);
  });

  it('excludes issues canceled at a delivery boundary and includes later cancellations', async () => {
    const canceled = stateNamed(workspace, 'Canceled');
    const atBoundary = await issue(
      workspace.admin,
      { title: 'Canceled at boundary', stateId: canceled.id },
      { createdAt: new Date('2026-08-01T01:00:00.000Z') },
    );
    const afterBoundary = await issue(
      workspace.admin,
      { title: 'Canceled after boundary', stateId: canceled.id },
      { createdAt: new Date('2026-08-01T02:00:00.000Z') },
    );
    await db
      .update(schema.issue)
      .set({ canceledAt: new Date('2026-08-02T00:00:00.000Z') })
      .where(eq(schema.issue.id, atBoundary));
    await db
      .update(schema.issue)
      .set({ canceledAt: new Date('2026-08-02T00:00:01.000Z') })
      .where(eq(schema.issue.id, afterBoundary));
    const includedQuery = analyticsQuerySchema.parse({ ...query(), includeCanceled: true });
    const overview = await loadAnalyticsOverview(workspace.admin, includedQuery, {
      now,
      timezone: 'UTC',
    });
    const point = overview.delivery.find((entry) => entry.date === '2026-08-01');
    if (point === undefined) throw new Error('Missing delivery point.');
    const drilldown = await listAnalyticsDrilldown(
      workspace.admin,
      { query: includedQuery, cohort: point.openCohort },
      { now, timezone: 'UTC', cursorSecret: 'analytics-test-secret' },
    );

    expect(point.open).toBe(1);
    expect(drilldown.issues.map((entry) => entry.title)).toEqual(['Canceled after boundary']);
  });

  it('keeps empty and malformed comparison cycle data nullable', async () => {
    const done = stateNamed(workspace, 'Done');
    await issue(
      workspace.admin,
      { title: 'Current valid cycle', stateId: done.id },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-04T00:00:00.000Z'),
      },
    );
    await issue(
      workspace.admin,
      { title: 'Previous malformed cycle', stateId: done.id },
      {
        createdAt: new Date('2026-07-24T00:00:00.000Z'),
        startedAt: new Date('2026-07-30T00:00:00.000Z'),
        completedAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    );
    const overview = await loadAnalyticsOverview(workspace.admin, query(), {
      now,
      timezone: 'UTC',
    });
    const cycleP50 = card(overview, 'cycle_time_p50');
    const comparison = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'comparison-throughput' } },
      { now, timezone: 'UTC', cursorSecret: 'analytics-test-secret' },
    );

    expect(cycleP50.value).toBe(2);
    expect(cycleP50.comparisonDelta).toBeNull();
    expect(comparison.details.validCycleCount).toBe(0);
    expect(comparison.details.cycleTimeP50).toBeNull();
    expect(comparison.issues[0]?.cycleTimeDays).toBeNull();
  });

  it('honors archived and canceled toggles across overview and drilldown', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const archivedId = await issue(
      workspace.admin,
      { title: 'Archived issue', stateId: todo.id },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    await archiveIssue(workspace.admin, archivedId);
    const canceledState = stateNamed(workspace, 'Canceled');
    await issue(
      workspace.admin,
      { title: 'Canceled issue', stateId: canceledState.id },
      { createdAt: new Date('2026-08-03T00:00:00.000Z') },
    );

    const hidden = await loadAnalyticsOverview(workspace.admin, query(), { now, timezone: 'UTC' });
    const includedQuery = analyticsQuerySchema.parse({
      ...query(),
      includeArchived: true,
      includeCanceled: true,
    });
    const included = await loadAnalyticsOverview(workspace.admin, includedQuery, {
      now,
      timezone: 'UTC',
    });
    const rows = await listAnalyticsDrilldown(
      workspace.admin,
      {
        query: includedQuery,
        cohort: { cohort: 'created' },
        limit: 100,
      },
      { now, timezone: 'UTC' },
    );

    expect(hidden.state).toHaveLength(0);
    expect(included.state.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(2);
    expect(rows.issues.map((entry) => entry.title).sort()).toEqual([
      'Archived issue',
      'Canceled issue',
    ]);
  });

  it('is workspace wide for every role and isolated to the principal organization', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
    const operationsTodo = states.find((state) => state.category === 'unstarted');
    if (operationsTodo === undefined) throw new Error('Missing Operations state.');
    await issue(
      workspace.admin,
      { teamId: team.id, title: 'Other team issue', stateId: operationsTodo.id },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    const outside = await createWorkspace('Outside');
    await createIssue(outside.admin, { teamId: outside.teamId, title: 'Outside issue' });
    const readers = await Promise.all(
      (['guest', 'contributor', 'member'] as const).map(
        async (role) => await addMember(workspace, role, { teamIds: [workspace.teamId] }),
      ),
    );

    for (const reader of readers) {
      const overview = await loadAnalyticsOverview(reader.principal, query(), {
        now,
        timezone: 'UTC',
      });
      expect(overview.state.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(1);
      const rows = await listAnalyticsDrilldown(
        reader.principal,
        {
          query: query(),
          cohort: { cohort: 'created' },
          limit: 100,
        },
        { now, timezone: 'UTC' },
      );
      expect(rows.issues.map((entry) => entry.title)).toEqual(['Other team issue']);
      expect(Object.keys(rows.issues[0] ?? {}).includes('organizationId')).toBe(false);
    }
  });
});
