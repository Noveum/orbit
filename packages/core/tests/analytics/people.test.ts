import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { type AnalyticsQuery, analyticsQuerySchema, UNSET_FILTER_VALUE } from '@orbit/shared';
import type { Principal } from '@orbit/shared/policy';
import { listAnalyticsDrilldown } from '../../src/analytics/drilldown.ts';
import { loadPeopleAnalytics, PEOPLE_ANALYTICS_LIMIT } from '../../src/analytics/people.ts';
import { loadSprintAnalytics } from '../../src/analytics/sprints.ts';
import { newId } from '../../src/internal.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createUser,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, setRelation } from '../../src/work/issue-service.ts';
import { createProject } from '../../src/work/project-service.ts';

const now = new Date('2026-08-13T12:00:00.000Z');

let workspace: Workspace;

function query(
  input: {
    readonly personId?: string;
    readonly measure?: 'issues' | 'points';
    readonly assignees?: readonly string[];
    readonly range?: AnalyticsQuery['range'];
    readonly includeArchived?: boolean;
    readonly includeCanceled?: boolean;
    readonly filter?: AnalyticsQuery['filter'];
  } = {},
): AnalyticsQuery {
  return analyticsQuerySchema.parse({
    lens: 'people',
    range: input.range ?? { preset: 'custom', from: '2026-08-01', to: '2026-08-10' },
    compare: 'none',
    measure: input.measure ?? 'issues',
    includeArchived: input.includeArchived ?? false,
    includeCanceled: input.includeCanceled ?? false,
    focus: input.personId === undefined ? {} : { personId: input.personId },
    filter: input.filter ?? {
      kind: 'group',
      combinator: 'and',
      children:
        input.assignees === undefined
          ? []
          : [
              {
                kind: 'condition',
                property: 'assignee',
                operator: 'in',
                values: [...input.assignees],
                negate: false,
              },
            ],
    },
  });
}

async function issue(
  principal: Principal,
  input: {
    readonly title: string;
    readonly assigneeId?: string | null;
    readonly teamId?: string;
    readonly stateId?: string;
    readonly projectId?: string;
    readonly cycleId?: string;
    readonly estimate?: number | null;
    readonly dueDate?: Date;
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
    assigneeId: input.assigneeId,
    stateId: input.stateId,
    projectId: input.projectId,
    cycleId: input.cycleId,
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
      stateEnteredAt: timestamps.stateEnteredAt ?? timestamps.updatedAt ?? timestamps.createdAt,
    })
    .where(eq(schema.issue.id, created.issue.id));
  return created.issue.id;
}

async function assignmentActivity(
  issueId: string,
  from: { readonly id: string; readonly name: string } | null,
  to: { readonly id: string; readonly name: string } | null,
  createdAt: string,
): Promise<void> {
  await db.insert(schema.issueActivity).values({
    id: newId(),
    organizationId: workspace.organizationId,
    issueId,
    actorType: 'user',
    actorId: workspace.adminUser.id,
    actorName: workspace.adminUser.name,
    field: 'assigneeId',
    fromValue: from,
    toValue: to,
    createdAt: new Date(createdAt),
  });
}

function personRow(result: Awaited<ReturnType<typeof loadPeopleAnalytics>>, personId: string) {
  const row = result.people.find((entry) => entry.person.id === personId);
  if (row === undefined) throw new Error('Missing person analytics row.');
  return row;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  await db.delete(schema.cycle);
});

describe('loadPeopleAnalytics', () => {
  it('defaults My work to the principal while listing every workspace person by name', async () => {
    const guest = await addMember(workspace, 'guest', { name: 'Zoe Guest', teamIds: [] });
    const otherTeam = await createTeam(workspace.admin, { name: 'Other', key: 'OTH' });
    const engineer = await addMember(workspace, 'member', {
      name: 'Alex Engineer',
      teamIds: [otherTeam.team.id],
    });
    await issue(
      engineer.principal,
      { title: 'Cross-team assignment', teamId: otherTeam.team.id, assigneeId: engineer.user.id },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    const otherWorkspace = await createWorkspace('Other');

    const result = await loadPeopleAnalytics(guest.principal, query(), { now, timezone: 'UTC' });
    const isolated = await loadPeopleAnalytics(otherWorkspace.admin, query(), {
      now,
      timezone: 'UTC',
    });

    expect(result.focused?.person.id).toBe(guest.user.id);
    expect(result.people.map((entry) => entry.person.name)).toEqual([
      'Ada Admin',
      'Alex Engineer',
      'Zoe Guest',
    ]);
    expect(personRow(result, engineer.user.id).currentAssignments).toBe(1);
    expect(isolated.people.some((entry) => entry.person.id === engineer.user.id)).toBe(false);
  });

  it('computes explicit workload and flow formulas and reconciles every count cohort', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Rae Engineer' });
    const project = await createProject(workspace.admin, {
      name: 'Launch',
      teamIds: [workspace.teamId],
    });
    const started = stateNamed(workspace, 'In Progress');
    const done = stateNamed(workspace, 'Done');
    const blocked = await issue(
      workspace.admin,
      {
        title: 'Blocked stale overdue',
        assigneeId: engineer.user.id,
        stateId: started.id,
        projectId: project.project.id,
        estimate: null,
        dueDate: new Date('2026-08-12T00:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-20T00:00:00.000Z'),
        startedAt: new Date('2026-07-10T00:00:00.000Z'),
        stateEnteredAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    );
    const blocker = await issue(
      workspace.admin,
      { title: 'Blocker', estimate: 2 },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );
    await setRelation(workspace.admin, blocker, { relatedIssueId: blocked, type: 'blocks' });
    await issue(
      workspace.admin,
      {
        title: 'One day completion',
        assigneeId: engineer.user.id,
        stateId: done.id,
        projectId: project.project.id,
        estimate: 3,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    );
    await issue(
      workspace.admin,
      {
        title: 'Seven day completion',
        assigneeId: engineer.user.id,
        stateId: done.id,
        estimate: 5,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    );

    const result = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id }),
      {
        now,
        timezone: 'UTC',
        cursorSecret: 'people-analytics-secret',
      },
    );
    const row = personRow(result, engineer.user.id);

    expect(row).toMatchObject({
      currentAssignments: 1,
      currentPoints: 1,
      completedIssues: 2,
      completedPoints: 8,
      activeWeeks: 2,
      averageThroughputIssues: 1,
      averageThroughputPoints: 4,
      currentWip: 1,
      blocked: 1,
      overdue: 1,
      stale: 1,
      unestimated: 1,
    });
    expect(row.cycleTime).toMatchObject({ valid: 2, p50: 4, p85: 6.1 });
    expect(row.leadTime).toMatchObject({ valid: 2, p50: 5, p85: 7.1 });
    expect(row.wipAge).toMatchObject({ valid: 1, p50: 34.5, p85: 34.5 });
    expect(result.formulas.activeWeek).toContain('distinct reporting weeks');
    expect(result.formulas.cycleTime).toContain('startedAt to completedAt');
    expect(result.formulas.leadTime).toContain('createdAt to completedAt');
    expect(result).not.toHaveProperty('score');
    expect(row).not.toHaveProperty('rank');

    for (const [cohort, count] of [
      [row.cohorts.currentAssignments, row.currentAssignments],
      [row.cohorts.completed, row.completedIssues],
      [row.cohorts.wip, row.currentWip],
      [row.cohorts.blocked, row.blocked],
      [row.cohorts.overdue, row.overdue],
      [row.cohorts.stale, row.stale],
      [row.cohorts.unestimated, row.unestimated],
    ] as const) {
      const evidence = await listAnalyticsDrilldown(
        workspace.admin,
        { query: query({ personId: engineer.user.id }), cohort, limit: 100 },
        { now, timezone: 'UTC', cursorSecret: 'people-analytics-secret' },
      );
      expect(evidence.total).toBe(count);
    }
  });

  it('weights an unestimated current issue as 1 point in the focused work groups', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Grouped Person' });
    const project = await createProject(workspace.admin, {
      name: 'Grouping',
      teamIds: [workspace.teamId],
    });
    const started = stateNamed(workspace, 'In Progress');
    await issue(
      workspace.admin,
      {
        title: 'Unestimated current work',
        assigneeId: engineer.user.id,
        projectId: project.project.id,
        stateId: started.id,
        estimate: null,
      },
      { createdAt: new Date('2026-08-02T00:00:00.000Z') },
    );

    const result = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id }),
      { now, timezone: 'UTC' },
    );

    expect(result.focused?.projects).toEqual([
      expect.objectContaining({ id: project.project.id, issues: 1, points: 1 }),
    ]);
    expect(result.focused?.states).toEqual([
      expect.objectContaining({ id: started.id, issues: 1, points: 1 }),
    ]);
  });

  it('labels captured, reconstructed, and current-assignee completion attribution', async () => {
    const captured = await addMember(workspace, 'member', { name: 'Captured Person' });
    const reconstructed = await addMember(workspace, 'member', { name: 'Reconstructed Person' });
    const fallback = await addMember(workspace, 'member', { name: 'Fallback Person' });
    const done = stateNamed(workspace, 'Done');
    const cycleId = newId();
    await db.insert(schema.cycle).values({
      id: cycleId,
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      number: 1,
      name: 'Sprint 1',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-11T00:00:00.000Z'),
      completedAt: new Date('2026-08-11T00:00:00.000Z'),
    });
    const capturedIssue = await issue(
      workspace.admin,
      { title: 'Captured', assigneeId: workspace.admin.userId, stateId: done.id },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    );
    await db.insert(schema.cycleIssueOutcome).values({
      id: newId(),
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      cycleId,
      issueId: capturedIssue,
      issueIdentifier: 'CAP-1',
      assigneeIdAtClose: captured.user.id,
      outcome: 'completed',
      completedAt: new Date('2026-08-03T00:00:00.000Z'),
      closedAt: new Date('2026-08-11T00:00:00.000Z'),
    });
    const reconstructedIssue = await issue(
      workspace.admin,
      { title: 'Reconstructed', assigneeId: workspace.admin.userId, stateId: done.id },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-04T00:00:00.000Z'),
      },
    );
    await assignmentActivity(
      reconstructedIssue,
      reconstructed.user,
      workspace.adminUser,
      '2026-08-05T00:00:00.000Z',
    );
    await issue(
      workspace.admin,
      { title: 'Fallback', assigneeId: fallback.user.id, stateId: done.id },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-06T00:00:00.000Z'),
      },
    );
    const formerMember = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, captured.user.id));
    const formerMemberId = formerMember[0]?.id;
    if (formerMemberId === undefined) throw new Error('Missing former member fixture.');
    await db.delete(schema.member).where(eq(schema.member.id, formerMemberId));

    const result = await loadPeopleAnalytics(workspace.admin, query(), { now, timezone: 'UTC' });

    expect(personRow(result, captured.user.id)).toMatchObject({
      completedIssues: 1,
      attribution: { captured: 1, reconstructed: 0, currentAssignee: 0, kind: 'captured' },
      person: { currentMember: false, status: 'former' },
    });
    expect(personRow(result, reconstructed.user.id)).toMatchObject({
      completedIssues: 1,
      attribution: { captured: 0, reconstructed: 1, currentAssignee: 0, kind: 'reconstructed' },
    });
    expect(personRow(result, fallback.user.id)).toMatchObject({
      completedIssues: 1,
      attribution: { captured: 0, reconstructed: 0, currentAssignee: 1, kind: 'current_assignee' },
    });
  });

  it('counts only reporting weeks touched by captured assignment episodes', async () => {
    const first = await addMember(workspace, 'member', { name: 'First Owner' });
    const second = await addMember(workspace, 'member', { name: 'Second Owner' });
    const done = stateNamed(workspace, 'Done');
    const issueId = await issue(
      workspace.admin,
      {
        title: 'Ownership handoff',
        assigneeId: second.user.id,
        stateId: done.id,
        estimate: 5,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-02T00:00:00.000Z'),
        completedAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    );
    await assignmentActivity(issueId, first.user, second.user, '2026-08-09T00:00:00.000Z');
    const otherIssueId = await issue(
      workspace.admin,
      {
        title: 'Other ownership handoff',
        assigneeId: second.user.id,
        stateId: done.id,
        estimate: 7,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date('2026-08-03T00:00:00.000Z'),
        completedAt: new Date('2026-08-09T12:00:00.000Z'),
      },
    );
    await assignmentActivity(otherIssueId, first.user, second.user, '2026-08-09T01:00:00.000Z');

    const result = await loadPeopleAnalytics(workspace.admin, query(), { now, timezone: 'UTC' });

    expect(personRow(result, first.user.id)).toMatchObject({
      activeWeeks: 2,
      completedIssues: 0,
    });
    expect(personRow(result, second.user.id)).toMatchObject({
      activeWeeks: 1,
      completedIssues: 2,
      averageThroughputIssues: 2,
    });
    expect(result.focused?.person.id).toBe(workspace.admin.userId);
    const secondFocus = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: second.user.id }),
      { now, timezone: 'UTC' },
    );
    const timelineDay = secondFocus.focused?.timeline.find((point) => point.date === '2026-08-09');
    expect(timelineDay).toEqual({
      date: '2026-08-09',
      assignedIssues: 2,
      assignedPoints: 12,
      completedIssues: 2,
      completedPoints: 12,
      assignedCohort: { cohort: `person-assigned:${second.user.id}`, bucket: '2026-08-09' },
      completedCohort: {
        cohort: `person-completed:${second.user.id}`,
        bucket: '2026-08-09',
      },
    });
  });

  it('ends fallback assignment episodes when completed and counts one active week over 90 days', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Brief Owner' });
    await issue(
      workspace.admin,
      {
        title: 'Brief completed assignment',
        assigneeId: engineer.user.id,
        stateId: stateNamed(workspace, 'Done').id,
      },
      {
        createdAt: new Date('2026-05-20T00:00:00.000Z'),
        completedAt: new Date('2026-05-21T00:00:00.000Z'),
      },
    );
    const result = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id, range: { preset: 'last_90_days' } }),
      { now, timezone: 'UTC' },
    );
    expect(result.focused?.activeWeeks).toBe(1);
  });

  it('retains historical Unassigned completion evidence after a later assignment', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Later Owner' });
    const completed = await issue(
      workspace.admin,
      {
        title: 'Completed before assignment',
        assigneeId: engineer.user.id,
        stateId: stateNamed(workspace, 'Done').id,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    );
    await assignmentActivity(completed, null, engineer.user, '2026-08-04T00:00:00.000Z');
    const result = await loadPeopleAnalytics(workspace.admin, query({ personId: 'unassigned' }), {
      now,
      timezone: 'UTC',
    });
    expect(result.focused).toMatchObject({
      person: { id: 'unassigned' },
      completedIssues: 1,
      attribution: { reconstructed: 1 },
    });
  });

  it('preserves boolean assignee semantics for focused history and safe person selection', async () => {
    const first = await addMember(workspace, 'member', { name: 'Boolean First' });
    const second = await addMember(workspace, 'member', { name: 'Boolean Second' });
    const project = await createProject(workspace.admin, {
      name: 'Boolean Project',
      teamIds: [workspace.teamId],
    });
    const done = stateNamed(workspace, 'Done');
    const firstIssue = await issue(
      workspace.admin,
      { title: 'First outside project', assigneeId: first.user.id, stateId: done.id },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    );
    const secondIssue = await issue(
      workspace.admin,
      {
        title: 'Second in project',
        assigneeId: second.user.id,
        stateId: done.id,
        projectId: project.project.id,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    );
    await assignmentActivity(firstIssue, first.user, second.user, '2026-08-03T00:00:00.000Z');
    await assignmentActivity(secondIssue, second.user, first.user, '2026-08-03T00:00:00.000Z');
    await db
      .update(schema.issue)
      .set({ assigneeId: second.user.id })
      .where(eq(schema.issue.id, firstIssue));
    await db
      .update(schema.issue)
      .set({ assigneeId: first.user.id })
      .where(eq(schema.issue.id, secondIssue));
    const disjunctionNode: AnalyticsQuery['filter'] = {
      kind: 'group',
      combinator: 'or',
      children: [
        {
          kind: 'condition',
          property: 'assignee',
          operator: 'in',
          values: [first.user.id],
          negate: false,
        },
        {
          kind: 'condition',
          property: 'project',
          operator: 'in',
          values: [project.project.id],
          negate: false,
        },
      ],
    };
    const disjunction: AnalyticsQuery['filter'] = {
      kind: 'group',
      combinator: 'and',
      children: [disjunctionNode],
    };
    const firstResult = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: first.user.id, filter: disjunction }),
      { now, timezone: 'UTC' },
    );
    const selectedResult = await loadPeopleAnalytics(
      workspace.admin,
      query({ filter: disjunction }),
      { now, timezone: 'UTC' },
    );
    const nested: AnalyticsQuery['filter'] = {
      kind: 'group',
      combinator: 'and',
      children: [
        disjunctionNode,
        {
          kind: 'condition',
          property: 'assignee',
          operator: 'in',
          values: [second.user.id],
          negate: true,
        },
      ],
    };
    const secondResult = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: second.user.id, filter: nested }),
      { now, timezone: 'UTC' },
    );
    expect(firstResult.focused?.completedIssues).toBe(1);
    expect(secondResult.focused?.completedIssues).toBe(0);
    expect(selectedResult.focused?.person.id).toBe(workspace.admin.userId);
    expect(selectedResult.people.some((row) => row.person.id === second.user.id)).toBe(true);
    expect(personRow(selectedResult, first.user.id)).toMatchObject({
      completedIssues: 1,
      activeWeeks: 1,
    });
    expect(personRow(selectedResult, second.user.id)).toMatchObject({
      completedIssues: 1,
      activeWeeks: 1,
    });
  });

  it('counts repeated same-bucket assignments once for both issues and points', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Repeated Owner' });
    const work = await issue(
      workspace.admin,
      { title: 'Repeated assignment', assigneeId: engineer.user.id, estimate: 5 },
      { createdAt: new Date('2026-08-01T00:00:00.000Z') },
    );
    await assignmentActivity(work, null, engineer.user, '2026-08-04T09:00:00.000Z');
    await assignmentActivity(work, null, engineer.user, '2026-08-04T10:00:00.000Z');
    const result = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id }),
      { now, timezone: 'UTC' },
    );
    const point = result.focused?.timeline.find((entry) => entry.date === '2026-08-04');
    expect(point).toMatchObject({ assignedIssues: 1, assignedPoints: 5 });
    if (point === undefined) throw new Error('Missing assignment timeline point.');
    const drilldown = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query({ personId: engineer.user.id }), cohort: point.assignedCohort },
      { now, timezone: 'UTC', cursorSecret: 'people-analytics-secret' },
    );
    expect(drilldown.total).toBe(point.assignedIssues);
  });

  it('weights an unestimated issue as 1 point in the assignment and completion timeline', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Timeline Person' });
    const assignedWork = await issue(
      workspace.admin,
      { title: 'Unestimated assignment', assigneeId: engineer.user.id, estimate: null },
      { createdAt: new Date('2026-08-01T00:00:00.000Z') },
    );
    await assignmentActivity(assignedWork, null, engineer.user, '2026-08-04T09:00:00.000Z');
    await issue(
      workspace.admin,
      {
        title: 'Unestimated completion',
        assigneeId: engineer.user.id,
        stateId: stateNamed(workspace, 'Done').id,
        estimate: null,
      },
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        completedAt: new Date('2026-08-04T00:00:00.000Z'),
      },
    );

    const result = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id }),
      { now, timezone: 'UTC' },
    );

    const point = result.focused?.timeline.find((entry) => entry.date === '2026-08-04');
    expect(point).toMatchObject({
      assignedIssues: 1,
      assignedPoints: 1,
      completedIssues: 1,
      completedPoints: 1,
    });
  });

  it('retains unassigned and deleted-user-safe evidence and caps the workspace list', async () => {
    const deleted = await createUser('Deleted Person');
    const work = await issue(
      workspace.admin,
      { title: 'Unassigned work', assigneeId: null },
      { createdAt: new Date('2026-08-03T00:00:00.000Z') },
    );
    await assignmentActivity(work, deleted, null, '2026-08-04T00:00:00.000Z');
    await db.delete(schema.user).where(eq(schema.user.id, deleted.id));
    const extra = Array.from({ length: PEOPLE_ANALYTICS_LIMIT + 5 }, (_, index) => index);
    for (const index of extra) {
      await addMember(workspace, 'member', { name: `Member ${String(index).padStart(3, '0')}` });
    }

    const result = await loadPeopleAnalytics(workspace.admin, query(), {
      now,
      timezone: 'UTC',
    });
    const unassignedResult = await loadPeopleAnalytics(
      workspace.admin,
      query({ assignees: [UNSET_FILTER_VALUE] }),
      { now, timezone: 'UTC' },
    );

    expect(result.people).toHaveLength(PEOPLE_ANALYTICS_LIMIT);
    expect(result.totalPeople).toBeGreaterThan(PEOPLE_ANALYTICS_LIMIT);
    expect(result.truncated).toBe(true);
    expect(unassignedResult.focused?.person).toMatchObject({
      id: 'unassigned',
      name: 'Unassigned',
    });
    const deletedResult = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: deleted.id }),
      { now, timezone: 'UTC' },
    );
    expect(deletedResult.focused?.person).toMatchObject({
      id: deleted.id,
      name: 'Deleted user',
      status: 'deleted',
    });
  });

  it('expands completion metrics from a custom window to all time', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Historical Person' });
    await issue(
      workspace.admin,
      {
        title: 'Historical completion',
        assigneeId: engineer.user.id,
        stateId: stateNamed(workspace, 'Done').id,
        estimate: 3,
      },
      {
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        completedAt: new Date('2025-01-03T00:00:00.000Z'),
      },
    );

    const custom = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id }),
      { now, timezone: 'UTC' },
    );
    const allTime = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id, range: { preset: 'all_time' } }),
      { now, timezone: 'UTC' },
    );

    expect(custom.focused?.completedIssues).toBe(0);
    expect(allTime.focused).toMatchObject({ completedIssues: 1, completedPoints: 3 });
  });

  it('delegates selected and previous personal burn to sprint analytics', async () => {
    const engineer = await addMember(workspace, 'member', { name: 'Sprint Person' });
    const activeCycleId = newId();
    const previousCycleId = newId();
    await db.insert(schema.cycle).values([
      {
        id: previousCycleId,
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        number: 1,
        name: 'Previous',
        startsAt: new Date('2026-07-20T00:00:00.000Z'),
        endsAt: new Date('2026-07-31T00:00:00.000Z'),
      },
      {
        id: activeCycleId,
        organizationId: workspace.organizationId,
        teamId: workspace.teamId,
        number: 2,
        name: 'Current',
        startsAt: new Date('2026-07-31T00:00:00.000Z'),
        endsAt: new Date('2026-08-21T00:00:00.000Z'),
      },
    ]);
    const currentIssue = await issue(
      workspace.admin,
      { title: 'Current sprint work', assigneeId: engineer.user.id, cycleId: activeCycleId },
      { createdAt: new Date('2026-08-01T00:00:00.000Z') },
    );
    const previousIssue = await issue(
      workspace.admin,
      {
        title: 'Previous sprint work',
        assigneeId: engineer.user.id,
        cycleId: previousCycleId,
        stateId: stateNamed(workspace, 'Done').id,
      },
      {
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        completedAt: new Date('2026-07-25T00:00:00.000Z'),
      },
    );
    await db
      .update(schema.cycle)
      .set({ completedAt: new Date('2026-07-31T00:00:00.000Z') })
      .where(eq(schema.cycle.id, previousCycleId));
    for (const [cycleId, issueId, addedAt] of [
      [activeCycleId, currentIssue, '2026-07-31T00:00:00.000Z'],
      [previousCycleId, previousIssue, '2026-07-20T00:00:00.000Z'],
    ] as const) {
      const selected = await db.select().from(schema.issue).where(eq(schema.issue.id, issueId));
      const row = selected[0];
      if (row === undefined) throw new Error('Missing sprint issue fixture.');
      await db
        .update(schema.cycleIssueMembership)
        .set({
          addedAt: new Date(addedAt),
          removedAt: cycleId === previousCycleId ? new Date('2026-07-30T23:59:59.000Z') : null,
          assigneeIdAtAdd: engineer.user.id,
        })
        .where(eq(schema.cycleIssueMembership.issueId, issueId));
    }

    const result = await loadPeopleAnalytics(
      workspace.admin,
      query({ personId: engineer.user.id, range: { preset: 'active_sprint' } }),
      { now, timezone: 'UTC', selectedSprintId: activeCycleId },
    );
    const delegated = await loadSprintAnalytics(
      workspace.admin,
      {
        ...query({ personId: engineer.user.id, range: { preset: 'active_sprint' } }),
        lens: 'sprints',
      },
      { now, timezone: 'UTC', selectedSprintId: activeCycleId },
    );

    expect(result.focused?.sprintBurn.current?.personId).toBe(engineer.user.id);
    expect(result.focused?.sprintBurn.current).toEqual(delegated.focus);
    expect(result.focused?.sprintBurn.previous?.personId).toBe(engineer.user.id);
    expect(result.focused?.sprintBurn.previous).toEqual(
      delegated.previous?.people.find((entry) => entry.personId === engineer.user.id),
    );
  });
});
