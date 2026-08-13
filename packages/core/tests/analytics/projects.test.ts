import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { type AnalyticsQuery, analyticsQuerySchema } from '@orbit/shared';
import type { Principal } from '@orbit/shared/policy';
import { listAnalyticsDrilldown } from '../../src/analytics/drilldown.ts';
import { loadProjectAnalytics, PROJECT_ANALYTICS_LIMIT } from '../../src/analytics/projects.ts';
import { newId } from '../../src/internal.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, setRelation } from '../../src/work/issue-service.ts';
import { createMilestone } from '../../src/work/milestone-service.ts';
import { createProject } from '../../src/work/project-service.ts';

const now = new Date('2026-08-13T12:00:00.000Z');

let workspace: Workspace;

function query(
  input: {
    readonly measure?: 'issues' | 'points';
    readonly projectId?: string;
    readonly milestoneId?: string;
    readonly includeArchived?: boolean;
    readonly focusProjectId?: string;
    readonly filter?: AnalyticsQuery['filter'];
    readonly from?: string;
    readonly to?: string;
  } = {},
): AnalyticsQuery {
  const children: AnalyticsQuery['filter']['children'][number][] = [];
  if (input.projectId !== undefined) {
    children.push({
      kind: 'condition',
      property: 'project',
      operator: 'in',
      values: [input.projectId],
      negate: false,
    });
  }
  if (input.milestoneId !== undefined) {
    children.push({
      kind: 'condition',
      property: 'milestone',
      operator: 'in',
      values: [input.milestoneId],
      negate: false,
    });
  }
  return analyticsQuerySchema.parse({
    lens: 'projects',
    range: {
      preset: 'custom',
      from: input.from ?? '2026-08-01',
      to: input.to ?? '2026-08-10',
    },
    compare: 'none',
    measure: input.measure ?? 'issues',
    includeArchived: input.includeArchived ?? false,
    filter: input.filter ?? { kind: 'group', combinator: 'and', children },
    focus: input.focusProjectId === undefined ? {} : { projectId: input.focusProjectId },
  });
}

async function projectActivity(
  issueId: string,
  from: { readonly id: string; readonly name: string } | null,
  to: { readonly id: string; readonly name: string },
  createdAt: string,
): Promise<void> {
  await db.insert(schema.issueActivity).values({
    id: newId(),
    organizationId: workspace.organizationId,
    issueId,
    actorType: 'user',
    actorId: workspace.adminUser.id,
    actorName: workspace.adminUser.name,
    field: 'projectId',
    fromValue: from,
    toValue: to,
    createdAt: new Date(createdAt),
  });
}

async function issue(
  principal: Principal,
  input: {
    readonly title: string;
    readonly teamId?: string;
    readonly stateId?: string;
    readonly projectId?: string;
    readonly milestoneId?: string;
    readonly estimate?: number | null;
    readonly dueDate?: Date;
  },
  timestamps: {
    readonly createdAt: Date;
    readonly updatedAt?: Date;
    readonly startedAt?: Date | null;
    readonly completedAt?: Date | null;
  },
): Promise<string> {
  const created = await createIssue(principal, {
    teamId: input.teamId ?? workspace.teamId,
    title: input.title,
    stateId: input.stateId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    estimate: input.estimate,
    dueDate: input.dueDate,
  });
  await db
    .update(schema.issue)
    .set({
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt ?? timestamps.createdAt,
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      stateEnteredAt: timestamps.updatedAt ?? timestamps.createdAt,
    })
    .where(eq(schema.issue.id, created.issue.id));
  return created.issue.id;
}

function projectRow(result: Awaited<ReturnType<typeof loadProjectAnalytics>>, projectId: string) {
  const found = result.projects.find((row) => row.id === projectId);
  if (found === undefined) throw new Error('Missing project analytics row.');
  return found;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('loadProjectAnalytics', () => {
  it('distinguishes a captured null project origin from missing project history', async () => {
    const beta = await createProject(workspace.admin, {
      name: 'Beta',
      teamIds: [workspace.teamId],
    });
    const fallback = await createProject(workspace.admin, {
      name: 'Current fallback',
      teamIds: [workspace.teamId],
    });
    const fromUnassigned = await issue(
      workspace.admin,
      { title: 'Unassigned at creation' },
      { createdAt: new Date('2026-08-04T00:00:00.000Z') },
    );
    await db
      .update(schema.issue)
      .set({ projectId: beta.project.id })
      .where(eq(schema.issue.id, fromUnassigned));
    await projectActivity(fromUnassigned, null, beta.project, '2026-08-12T00:00:00.000Z');
    await issue(
      workspace.admin,
      { title: 'No activity fallback', projectId: fallback.project.id },
      { createdAt: new Date('2026-08-05T00:00:00.000Z') },
    );

    const result = await loadProjectAnalytics(workspace.admin, query(), { now, timezone: 'UTC' });
    const betaRow = projectRow(result, beta.project.id);
    const fallbackRow = projectRow(result, fallback.project.id);
    const betaEvidence = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: betaRow.cohorts.scopeAdded },
      { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
    );

    expect(betaRow.scopeAddedIssues).toBe(0);
    expect(betaRow.scopeAddedCoverage).toBe('captured');
    expect(betaEvidence.total).toBe(0);
    expect(fallbackRow.scopeAddedIssues).toBe(1);
    expect(fallbackRow.scopeAddedCoverage).toBe('current_project');
  });

  it('preserves nested filter logic and never lets focus bypass the active predicate', async () => {
    const alpha = await createProject(workspace.admin, {
      name: 'Alpha',
      teamIds: [workspace.teamId],
    });
    const beta = await createProject(workspace.admin, {
      name: 'Beta',
      teamIds: [workspace.teamId],
    });
    const betaMilestone = await createMilestone(workspace.admin, {
      projectId: beta.project.id,
      name: 'Beta milestone',
    });
    await issue(
      workspace.admin,
      { title: 'Alpha work', projectId: alpha.project.id },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    await issue(
      workspace.admin,
      { title: 'Beta work', projectId: beta.project.id },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    const condition = (
      property: 'project' | 'milestone',
      values: readonly string[],
      negate = false,
    ): AnalyticsQuery['filter']['children'][number] => ({
      kind: 'condition',
      property,
      operator: 'in',
      values: [...values],
      negate,
    });
    const mismatch = query({
      focusProjectId: beta.project.id,
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          condition('project', [alpha.project.id]),
          condition('milestone', [betaMilestone.milestone.id]),
        ],
      },
    });
    const nested = query({
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          condition('project', [alpha.project.id]),
          {
            kind: 'group',
            combinator: 'or',
            children: [
              condition('milestone', [betaMilestone.milestone.id]),
              condition('project', [alpha.project.id], true),
            ],
          },
        ],
      },
    });
    const focusedMismatch = await loadProjectAnalytics(workspace.admin, mismatch, {
      now,
      timezone: 'UTC',
    });
    const nestedMismatch = await loadProjectAnalytics(workspace.admin, nested, {
      now,
      timezone: 'UTC',
    });
    const staleFocus = await loadProjectAnalytics(
      workspace.admin,
      query({ projectId: alpha.project.id, focusProjectId: beta.project.id }),
      { now, timezone: 'UTC' },
    );

    expect(focusedMismatch.projects).toEqual([]);
    expect(focusedMismatch.focused).toBeNull();
    expect(nestedMismatch.projects).toEqual([]);
    expect(staleFocus.projects.map((row) => row.id)).toEqual([alpha.project.id]);
    expect(staleFocus.focused).toBeNull();
  });

  it('chooses the next milestone from actual scope before applying explicit milestone selection', async () => {
    const project = await createProject(workspace.admin, {
      name: 'Launch',
      teamIds: [workspace.teamId],
    });
    const alpha = await createMilestone(workspace.admin, {
      projectId: project.project.id,
      name: 'Alpha',
    });
    const beta = await createMilestone(workspace.admin, {
      projectId: project.project.id,
      name: 'Beta',
    });
    await issue(
      workspace.admin,
      {
        title: 'Alpha complete',
        projectId: project.project.id,
        milestoneId: alpha.milestone.id,
        stateId: stateNamed(workspace, 'Done').id,
      },
      {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        completedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    );
    await issue(
      workspace.admin,
      { title: 'Beta open', projectId: project.project.id, milestoneId: beta.milestone.id },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );

    const all = await loadProjectAnalytics(
      workspace.admin,
      query({ focusProjectId: project.project.id }),
      { now, timezone: 'UTC' },
    );
    const selected = await loadProjectAnalytics(
      workspace.admin,
      query({ milestoneId: beta.milestone.id, focusProjectId: project.project.id }),
      { now, timezone: 'UTC' },
    );

    expect(projectRow(all, project.project.id).nextMilestoneId).toBe(beta.milestone.id);
    expect(all.focused?.milestones).toEqual([
      expect.objectContaining({ id: alpha.milestone.id, scopeIssues: 1, completedIssues: 1 }),
      expect.objectContaining({ id: beta.milestone.id, scopeIssues: 1, completedIssues: 0 }),
    ]);
    expect(projectRow(selected, project.project.id).nextMilestoneId).toBe(beta.milestone.id);
    expect(selected.focused?.milestones).toEqual([
      expect.objectContaining({ id: beta.milestone.id, scopeIssues: 1, completedIssues: 0 }),
    ]);
  });

  it('attributes scope entry from project history and reconciles exact evidence', async () => {
    const alpha = await createProject(workspace.admin, {
      name: 'Alpha',
      teamIds: [workspace.teamId],
    });
    const beta = await createProject(workspace.admin, {
      name: 'Beta',
      teamIds: [workspace.teamId],
    });
    const movedIn = await issue(
      workspace.admin,
      { title: 'Moved in during range', projectId: beta.project.id },
      { createdAt: new Date('2026-07-01T00:00:00.000Z') },
    );
    await projectActivity(movedIn, alpha.project, beta.project, '2026-08-05T00:00:00.000Z');
    const movedAfter = await issue(
      workspace.admin,
      { title: 'Created in Alpha then moved later', projectId: beta.project.id },
      { createdAt: new Date('2026-08-03T00:00:00.000Z') },
    );
    await projectActivity(movedAfter, alpha.project, beta.project, '2026-08-12T00:00:00.000Z');
    const movedBefore = await issue(
      workspace.admin,
      { title: 'Moved before range', projectId: beta.project.id },
      { createdAt: new Date('2026-07-01T00:00:00.000Z') },
    );
    await projectActivity(movedBefore, alpha.project, beta.project, '2026-07-15T00:00:00.000Z');
    await issue(
      workspace.admin,
      { title: 'Current-project attribution', projectId: beta.project.id },
      { createdAt: new Date('2026-08-04T00:00:00.000Z') },
    );

    const result = await loadProjectAnalytics(workspace.admin, query(), { now, timezone: 'UTC' });
    const alphaRow = projectRow(result, alpha.project.id);
    const betaRow = projectRow(result, beta.project.id);

    expect(alphaRow.scopeAddedIssues).toBe(1);
    expect(betaRow.scopeAddedIssues).toBe(2);
    expect(betaRow.scopeAddedCoverage).toBe('mixed');
    for (const row of [alphaRow, betaRow]) {
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        { query: query(), cohort: row.cohorts.scopeAdded },
        { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
      );
      expect(drilldown.total).toBe(row.scopeAddedIssues);
    }
  });

  it('labels delivery buckets in the reporting calendar and reconciles bucket completions', async () => {
    const project = await createProject(workspace.admin, {
      name: 'Calendar launch',
      teamIds: [workspace.teamId],
    });
    await issue(
      workspace.admin,
      {
        title: 'Local completion',
        projectId: project.project.id,
        stateId: stateNamed(workspace, 'Done').id,
      },
      {
        createdAt: new Date('2026-07-31T19:00:00.000Z'),
        completedAt: new Date('2026-08-01T04:00:00.000Z'),
      },
    );
    const kolkata = await loadProjectAnalytics(
      workspace.admin,
      query({ focusProjectId: project.project.id, from: '2026-08-01', to: '2026-08-03' }),
      { now, timezone: 'Asia/Kolkata' },
    );
    const dst = await loadProjectAnalytics(
      workspace.admin,
      query({ focusProjectId: project.project.id, from: '2026-03-07', to: '2026-03-10' }),
      { now, timezone: 'America/New_York' },
    );
    const first = kolkata.focused?.delivery[0];
    if (first === undefined) throw new Error('Missing Kolkata delivery bucket.');

    expect(kolkata.focused?.delivery.map((point) => point.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
    expect(dst.focused?.delivery.map((point) => point.date)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    const completed = await listAnalyticsDrilldown(
      workspace.admin,
      {
        query: query({ from: '2026-08-01', to: '2026-08-03' }),
        cohort: first.completedInBucketCohort,
      },
      { now, timezone: 'Asia/Kolkata', cursorSecret: 'project-analytics-secret' },
    );
    expect(completed.total).toBe(first.completedInBucket);
    await expect(
      listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query({ from: '2026-08-01', to: '2026-08-03' }),
          cohort: { cohort: first.completedInBucketCohort.cohort },
        },
        { now, timezone: 'Asia/Kolkata', cursorSecret: 'project-analytics-secret' },
      ),
    ).rejects.toThrow('needs a bucket');
  });

  it('summarizes manual health, progress, risk, scope additions, and focused milestone evidence', async () => {
    const secondTeam = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
    const created = await createProject(workspace.admin, {
      name: 'Launch',
      health: 'at_risk',
      status: 'in_progress',
      targetDate: new Date('2026-08-20T00:00:00.000Z'),
      teamIds: [workspace.teamId, secondTeam.team.id],
    });
    const alpha = await createMilestone(workspace.admin, {
      projectId: created.project.id,
      name: 'Alpha',
      targetDate: new Date('2026-08-05T00:00:00.000Z'),
    });
    const beta = await createMilestone(workspace.admin, {
      projectId: created.project.id,
      name: 'Beta',
      targetDate: new Date('2026-08-18T00:00:00.000Z'),
    });
    const empty = await createMilestone(workspace.admin, {
      projectId: created.project.id,
      name: 'General availability',
    });
    const done = stateNamed(workspace, 'Done');
    const started = stateNamed(workspace, 'In Progress');
    const secondStarted = secondTeam.states.find((state) => state.name === 'In Progress');
    if (secondStarted === undefined) throw new Error('Missing second-team started state.');
    await issue(
      workspace.admin,
      {
        title: 'Alpha shipped',
        stateId: done.id,
        projectId: created.project.id,
        milestoneId: alpha.milestone.id,
        estimate: 3,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-04T00:00:00.000Z'),
      },
    );
    const blocked = await issue(
      workspace.admin,
      {
        title: 'Blocked beta work',
        stateId: started.id,
        projectId: created.project.id,
        milestoneId: beta.milestone.id,
        estimate: 5,
        dueDate: new Date('2026-08-10T00:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-08-03T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    );
    const blocker = await issue(
      workspace.admin,
      { title: 'Blocker', projectId: created.project.id, estimate: null },
      {
        createdAt: new Date('2026-08-06T00:00:00.000Z'),
        updatedAt: new Date('2026-08-06T00:00:00.000Z'),
      },
    );
    await setRelation(workspace.admin, blocker, { relatedIssueId: blocked, type: 'blocks' });
    await issue(
      workspace.admin,
      {
        title: 'Operations beta work',
        teamId: secondTeam.team.id,
        stateId: secondStarted.id,
        projectId: created.project.id,
        milestoneId: beta.milestone.id,
        estimate: 2,
        dueDate: new Date('2026-08-11T00:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-08-12T00:00:00.000Z'),
        startedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    );

    const result = await loadProjectAnalytics(
      workspace.admin,
      query({ focusProjectId: created.project.id }),
      { now, timezone: 'UTC' },
    );
    const row = projectRow(result, created.project.id);

    expect(row).toMatchObject({
      health: 'at_risk',
      healthSource: 'manual',
      status: 'in_progress',
      scopeIssues: 4,
      scopePoints: 10,
      openIssues: 3,
      completedIssues: 1,
      blocked: 1,
      overdue: 2,
      stale: 1,
      unestimated: 1,
      scopeAddedIssues: 3,
      completedInRangeIssues: 1,
      targetDate: '2026-08-20',
      nextMilestoneName: 'Beta',
      estimateCoverage: 'mixed',
    });
    expect(row.teams.map((team) => team.name)).toEqual(['Nova', 'Operations']);
    expect(result.focused?.delivery.length).toBeGreaterThan(0);
    expect(result.focused?.milestones).toEqual([
      expect.objectContaining({ id: alpha.milestone.id, scopeIssues: 1, completedIssues: 1 }),
      expect.objectContaining({ id: beta.milestone.id, scopeIssues: 2, completedIssues: 0 }),
      expect.objectContaining({ id: empty.milestone.id, scopeIssues: 0, completedIssues: 0 }),
    ]);

    for (const [cohort, expected] of [
      [row.cohorts.blocked, row.blocked],
      [row.cohorts.overdue, row.overdue],
      [row.cohorts.stale, row.stale],
      [row.cohorts.unestimated, row.unestimated],
      [row.cohorts.scopeAdded, row.scopeAddedIssues],
      [row.cohorts.completedInRange, row.completedInRangeIssues],
    ] as const) {
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        { query: query({ focusProjectId: created.project.id }), cohort, limit: 100 },
        { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
      );
      expect(drilldown.total).toBe(expected);
    }
    if (result.focused === null) throw new Error('Missing focused project analytics.');
    for (const milestone of result.focused.milestones) {
      const current = await listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query({ focusProjectId: created.project.id }),
          cohort: milestone.currentCohort,
        },
        { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
      );
      const completed = await listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query({ focusProjectId: created.project.id }),
          cohort: milestone.completedCohort,
        },
        { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
      );
      expect(current.total).toBe(milestone.scopeIssues);
      expect(completed.total).toBe(milestone.completedIssues);
    }
    const finalDelivery = result.focused.delivery.at(-1);
    if (finalDelivery === undefined) throw new Error('Missing focused delivery point.');
    for (const [cohort, expected] of [
      [finalDelivery.scopeCohort, finalDelivery.scope],
      [finalDelivery.startedCohort, finalDelivery.started],
      [finalDelivery.completedCohort, finalDelivery.completed],
      [finalDelivery.openCohort, finalDelivery.open],
      [finalDelivery.addedCohort, finalDelivery.added],
    ] as const) {
      const drilldown = await listAnalyticsDrilldown(
        workspace.admin,
        { query: query({ focusProjectId: created.project.id }), cohort },
        { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
      );
      expect(drilldown.total).toBe(expected);
    }
  });

  it('applies project and empty milestone filters while keeping archived projects explicit', async () => {
    const active = await createProject(workspace.admin, {
      name: 'Active',
      teamIds: [workspace.teamId],
    });
    const archived = await createProject(workspace.admin, {
      name: 'Archived',
      teamIds: [workspace.teamId],
    });
    const empty = await createMilestone(workspace.admin, {
      projectId: active.project.id,
      name: 'Empty milestone',
    });
    await db
      .update(schema.project)
      .set({ archivedAt: new Date('2026-08-01T00:00:00.000Z') })
      .where(eq(schema.project.id, archived.project.id));

    const milestoneResult = await loadProjectAnalytics(
      workspace.admin,
      query({ milestoneId: empty.milestone.id, focusProjectId: active.project.id }),
      { now, timezone: 'UTC' },
    );
    const hiddenArchived = await loadProjectAnalytics(
      workspace.admin,
      query({ projectId: archived.project.id, focusProjectId: archived.project.id }),
      { now, timezone: 'UTC' },
    );
    const shownArchived = await loadProjectAnalytics(
      workspace.admin,
      query({
        projectId: archived.project.id,
        focusProjectId: archived.project.id,
        includeArchived: true,
      }),
      { now, timezone: 'UTC' },
    );

    expect(milestoneResult.projects.map((row) => row.id)).toEqual([active.project.id]);
    expect(milestoneResult.focused?.milestones).toEqual([
      expect.objectContaining({ id: empty.milestone.id, scopeIssues: 0, completedIssues: 0 }),
    ]);
    expect(hiddenArchived.projects).toEqual([]);
    expect(hiddenArchived.focused).toBeNull();
    expect(shownArchived.projects).toEqual([
      expect.objectContaining({ id: archived.project.id, archived: true }),
    ]);
    expect(shownArchived.focused?.project.id).toBe(archived.project.id);
  });

  it('uses the selected measure without losing issue and point progress', async () => {
    const created = await createProject(workspace.admin, {
      name: 'Mixed estimates',
      teamIds: [workspace.teamId],
    });
    await issue(
      workspace.admin,
      { title: 'Estimated', projectId: created.project.id, estimate: 8 },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    await issue(
      workspace.admin,
      { title: 'Unestimated', projectId: created.project.id, estimate: null },
      { createdAt: new Date('2026-08-03T00:00:00.000Z') },
    );

    const result = await loadProjectAnalytics(
      workspace.admin,
      query({ measure: 'points', focusProjectId: created.project.id }),
      { now, timezone: 'UTC' },
    );
    const row = projectRow(result, created.project.id);
    const drilldown = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query({ measure: 'points' }), cohort: row.cohorts.current },
      { now, timezone: 'UTC', cursorSecret: 'project-analytics-secret' },
    );

    expect(row).toMatchObject({
      scopeIssues: 2,
      scopePoints: 8,
      unestimated: 1,
      estimateCoverage: 'mixed',
    });
    expect(drilldown.total).toBe(2);
    expect(drilldown.totalValue).toBe(8);
  });

  it('lets every workspace role inspect projects across teams without crossing organizations', async () => {
    const secondTeam = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
    const project = await createProject(workspace.admin, {
      name: 'Operations only',
      teamIds: [secondTeam.team.id],
    });
    const outsider = await createWorkspace('Other');
    await createProject(outsider.admin, { name: 'Secret', teamIds: [outsider.teamId] });
    const principals = await Promise.all(
      (['guest', 'contributor', 'member'] as const).map(
        async (role) => (await addMember(workspace, role, { teamIds: [] })).principal,
      ),
    );

    for (const principal of [...principals, workspace.admin]) {
      const result = await loadProjectAnalytics(principal, query(), { now, timezone: 'UTC' });
      expect(result.projects.map((row) => row.id)).toContain(project.project.id);
      expect(result.projects.map((row) => row.name)).not.toContain('Secret');
    }
    const other = await loadProjectAnalytics(outsider.admin, query(), { now, timezone: 'UTC' });
    expect(other.projects.map((row) => row.name)).toEqual(['Secret']);
  });

  it('caps and stably orders a large portfolio', async () => {
    await db.insert(schema.project).values(
      Array.from({ length: PROJECT_ANALYTICS_LIMIT + 5 }, (_, index) => ({
        id: newId(),
        organizationId: workspace.organizationId,
        name: `Portfolio ${String(PROJECT_ANALYTICS_LIMIT + 5 - index).padStart(3, '0')}`,
        slug: `portfolio-${index}`,
      })),
    );

    const result = await loadProjectAnalytics(workspace.admin, query(), {
      now,
      timezone: 'UTC',
    });

    expect(result.projects).toHaveLength(PROJECT_ANALYTICS_LIMIT);
    expect(result.totalProjects).toBe(PROJECT_ANALYTICS_LIMIT + 5);
    expect(result.truncated).toBe(true);
    expect(result.projects[0]?.name).toBe('Portfolio 001');
    expect(result.projects.at(-1)?.name).toBe(`Portfolio ${PROJECT_ANALYTICS_LIMIT}`);
  });
});
