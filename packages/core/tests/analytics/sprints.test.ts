import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { type AnalyticsQuery, analyticsQuerySchema } from '@orbit/shared';
import { loadSprintAnalytics } from '../../src/analytics/sprints.ts';
import { insertIssue } from '../../src/analytics/test-fixtures.ts';
import { newId } from '../../src/internal.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;
const DAY_MILLISECONDS = 86_400_000;

function sprintQuery(cycleId: string, measure: 'issues' | 'points' = 'issues'): AnalyticsQuery {
  return analyticsQuerySchema.parse({
    lens: 'sprints',
    measure,
    filter: {
      kind: 'group',
      combinator: 'and',
      children: [
        {
          kind: 'condition',
          property: 'cycle',
          operator: 'in',
          values: [cycleId],
          negate: false,
        },
      ],
    },
  });
}

async function cycle(
  number: number,
  startsAt: string,
  endsAt: string,
  input: { readonly completedAt?: string; readonly timezone?: string } = {},
): Promise<string> {
  const id = newId();
  await db.insert(schema.cycle).values({
    id,
    organizationId: workspace.organizationId,
    number,
    name: '',
    timezone: input.timezone ?? 'UTC',
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    completedAt: input.completedAt === undefined ? null : new Date(input.completedAt),
  });
  return id;
}

async function membership(
  cycleId: string,
  issueId: string,
  input: {
    readonly addedAt: string;
    readonly removedAt?: string;
    readonly estimate?: number | null;
    readonly assigneeId?: string | null;
    readonly coverage?: 'captured' | 'observed';
    readonly entryKind?: 'added' | 'rollover' | 'bootstrap';
  },
): Promise<void> {
  const [issue] = await db.select().from(schema.issue).where(eq(schema.issue.id, issueId)).limit(1);
  if (issue === undefined) throw new Error('Missing issue fixture.');
  await db.insert(schema.cycleIssueMembership).values({
    id: newId(),
    organizationId: workspace.organizationId,
    teamId: issue.teamId,
    cycleId,
    issueId,
    issueIdentifier: issue.identifier,
    addedAt: new Date(input.addedAt),
    removedAt: input.removedAt === undefined ? null : new Date(input.removedAt),
    estimateAtAdd: input.estimate,
    assigneeIdAtAdd: input.assigneeId,
    entryKind: input.entryKind ?? 'added',
    coverage: input.coverage ?? 'captured',
  });
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  await db.delete(schema.cycle);
});

describe('loadSprintAnalytics', () => {
  it('burns completed work on the sprint local day and changes between snapshots', async () => {
    const cycleId = await cycle(1, '2026-03-07T05:00:00.000Z', '2026-03-12T04:00:00.000Z', {
      timezone: 'America/New_York',
    });
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Done',
      cycleId,
      estimate: 3,
      createdAt: new Date('2026-03-06T12:00:00.000Z'),
      completedAt: new Date('2026-03-08T07:30:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-03-06T12:00:00.000Z',
      estimate: 3,
    });
    await db.insert(schema.cycleProgressSnapshot).values({
      id: newId(),
      organizationId: workspace.organizationId,
      cycleId,
      capturedOn: '2026-03-07',
      totalIssues: 1,
      unstartedIssues: 1,
      totalEstimate: 3,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-03-08T12:00:00.000Z'),
    });

    expect(result.current.burn.map((point) => point.date)).toEqual(['2026-03-07', '2026-03-08']);
    expect(result.current.burn.map((point) => point.remaining)).toEqual([1, 0]);
    expect(result.current.burn[1]?.completed).toBe(1);
    expect(result.formulas.burn).toContain('local calendar day');
  });

  it('keeps removal history, counts net-zero churn, and supports re-addition intervals', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const stable = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    const moved = await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId: null,
      createdAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    await membership(cycleId, stable, { addedAt: '2025-12-20T00:00:00.000Z' });
    await membership(cycleId, moved, {
      addedAt: '2026-01-03T08:00:00.000Z',
      removedAt: '2026-01-03T12:00:00.000Z',
    });
    await membership(cycleId, moved, {
      addedAt: '2026-01-04T08:00:00.000Z',
      removedAt: '2026-01-05T08:00:00.000Z',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-06T12:00:00.000Z'),
    });

    expect(result.current.scopeChanges).toMatchObject({ added: 2, removed: 2 });
    expect(result.current.burn.map((point) => point.scope)).toEqual([1, 1, 1, 2, 1, 1]);
    expect(result.current.cohorts.removed).toContain(moved);
  });

  it('applies captured 24-hour planning, excludes uncommitted work, and exposes null estimates', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const planned = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      estimate: 5,
    });
    const late = await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      estimate: null,
    });
    const backlog = await insertIssue(workspace, {
      number: 3,
      state: 'Backlog',
      cycleId,
      estimate: 8,
    });
    const observed = await insertIssue(workspace, {
      number: 4,
      state: 'Todo',
      cycleId,
      estimate: 3,
    });
    await membership(cycleId, planned, {
      addedAt: '2026-01-01T23:59:00.000Z',
      estimate: 5,
    });
    await membership(cycleId, late, { addedAt: '2026-01-02T00:01:00.000Z', estimate: null });
    await membership(cycleId, backlog, { addedAt: '2025-12-20T00:00:00.000Z', estimate: 8 });
    await membership(cycleId, observed, {
      addedAt: '2026-01-01T01:00:00.000Z',
      estimate: 3,
      coverage: 'observed',
      entryKind: 'bootstrap',
    });

    const issues = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-03T12:00:00.000Z'),
    });
    const points = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId, 'points'), {
      now: new Date('2026-01-03T12:00:00.000Z'),
    });

    expect(issues.current.summary).toMatchObject({ planned: 1, currentScope: 3, unestimated: 1 });
    expect(points.current.summary).toMatchObject({ planned: 5, currentScope: 8, unestimated: 1 });
    expect(issues.current.cohorts.planned).toEqual([planned]);
    expect(issues.coverage.kind).toBe('observed');
  });

  it('aligns previous burn and freezes completed outcomes while preserving person attribution', async () => {
    const person = await addMember(workspace, 'member', { name: 'Grace' });
    const previousId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', {
      completedAt: '2026-01-08T00:00:00.000Z',
    });
    const currentId = await cycle(2, '2026-01-08T00:00:00.000Z', '2026-01-15T00:00:00.000Z');
    const previousIssue = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: currentId,
      assigneeId: person.user.id,
      estimate: 3,
    });
    await membership(previousId, previousIssue, {
      addedAt: '2025-12-20T00:00:00.000Z',
      removedAt: '2026-01-08T00:00:00.000Z',
      assigneeId: person.user.id,
      estimate: 3,
    });
    await membership(currentId, previousIssue, {
      addedAt: '2026-01-08T00:00:00.000Z',
      assigneeId: person.user.id,
      estimate: 3,
      entryKind: 'rollover',
    });
    await db.insert(schema.cycleIssueOutcome).values({
      id: newId(),
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      cycleId: previousId,
      issueId: previousIssue,
      issueIdentifier: 'NOV-1',
      planned: true,
      estimateAtCommitment: 3,
      estimateAtClose: 3,
      assigneeIdAtClose: person.user.id,
      outcome: 'carryover',
      closedAt: new Date('2026-01-08T00:00:00.000Z'),
      rolloverCycleId: currentId,
    });

    const result = await loadSprintAnalytics(
      workspace.admin,
      analyticsQuerySchema.parse({
        ...sprintQuery(currentId),
        focus: { personId: person.user.id },
      }),
      { now: new Date('2026-01-10T12:00:00.000Z') },
    );

    expect(result.previous?.burn[0]?.workingDay).toBe(1);
    expect(result.previous?.summary.carryover).toBe(1);
    expect(result.focus?.personId).toBe(person.user.id);
    expect(result.focus?.burn.at(-1)?.remaining).toBe(1);
    expect(result.current.cohorts.carryover).toContain(previousIssue);
  });

  it('attributes workspace scope across teams and keeps archived current rows in captured history', async () => {
    const sibling = await createTeam(workspace.admin, { name: 'Platform', key: 'PLAT' });
    const [existingCycle] = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, workspace.organizationId));
    if (existingCycle === undefined) throw new Error('Missing workspace sprint.');
    const cycleId = existingCycle.id;
    const primary = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      estimate: 2,
    });
    const siblingIssue = newId();
    const siblingTodo = await db
      .select()
      .from(schema.workflowState)
      .where(eq(schema.workflowState.teamId, sibling.team.id));
    const todo = siblingTodo.find((state) => state.category === 'unstarted');
    if (todo === undefined) throw new Error('Missing sibling Todo state.');
    await db.insert(schema.issue).values({
      id: siblingIssue,
      organizationId: workspace.organizationId,
      teamId: sibling.team.id,
      number: 1,
      identifier: 'PLAT-1',
      title: 'Sibling work',
      stateId: todo.id,
      creatorId: workspace.adminUser.id,
      cycleId,
      estimate: 3,
      archivedAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    await membership(cycleId, primary, { addedAt: '2025-12-20T00:00:00.000Z', estimate: 2 });
    await membership(cycleId, siblingIssue, {
      addedAt: '2025-12-20T00:00:00.000Z',
      estimate: 3,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId, 'points'), {
      now: new Date(existingCycle.startsAt.getTime() + DAY_MILLISECONDS),
    });

    expect(result.current.summary.currentScope).toBe(5);
    expect(result.current.teams.map((team) => team.id).sort()).toEqual(
      [workspace.teamId, sibling.team.id].sort(),
    );
  });

  it('uses assignment facts for personal burn and current My work after an assignee change', async () => {
    const first = await addMember(workspace, 'member', { name: 'Grace' });
    const second = await addMember(workspace, 'member', { name: 'Linus' });
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      assigneeId: second.user.id,
    });
    await membership(cycleId, issueId, {
      addedAt: '2025-12-20T00:00:00.000Z',
      assigneeId: first.user.id,
    });
    await db.insert(schema.issueActivity).values({
      id: newId(),
      organizationId: workspace.organizationId,
      issueId,
      actorType: 'user',
      actorId: workspace.adminUser.id,
      actorName: workspace.adminUser.name,
      field: 'assigneeId',
      fromValue: { id: first.user.id, name: first.user.name },
      toValue: { id: second.user.id, name: second.user.name },
      createdAt: new Date('2026-01-03T12:00:00.000Z'),
    });
    const focusedQuery = (personId: string) =>
      analyticsQuerySchema.parse({ ...sprintQuery(cycleId), focus: { personId } });

    const firstResult = await loadSprintAnalytics(workspace.admin, focusedQuery(first.user.id), {
      now: new Date('2026-01-04T12:00:00.000Z'),
    });
    const secondResult = await loadSprintAnalytics(workspace.admin, focusedQuery(second.user.id), {
      now: new Date('2026-01-04T12:00:00.000Z'),
    });

    expect(firstResult.focus?.burn.map((point) => point.remaining)).toEqual([1, 1, 0, 0]);
    expect(secondResult.focus?.burn.map((point) => point.remaining)).toEqual([0, 0, 1, 1]);
    expect(secondResult.focus?.summary.currentScope).toBe(1);
  });

  it('returns an honest first-sprint state', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-02T12:00:00.000Z'),
    });
    expect(result.previous).toBeNull();
    expect(result.coverage.kind).toBe('observed');
  });
});
