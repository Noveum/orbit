import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { type AnalyticsQuery, analyticsQuerySchema } from '@orbit/shared';
import {
  loadSprintAnalytics,
  type SprintAnalytics,
  type SprintDetail,
} from '../../src/analytics/sprints.ts';
import { createProjectRow, insertIssue } from '../../src/analytics/test-fixtures.ts';
import { newId } from '../../src/internal.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;
const DAY_MILLISECONDS = 86_400_000;

function currentOf(analytics: SprintAnalytics): SprintDetail {
  if (analytics.current === null) throw new Error('Expected a selected sprint.');
  return analytics.current;
}

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
    readonly teamId?: string;
    readonly coverage?: 'captured' | 'observed';
    readonly entryKind?: 'added' | 'rollover' | 'bootstrap';
  },
): Promise<void> {
  const [issue] = await db.select().from(schema.issue).where(eq(schema.issue.id, issueId)).limit(1);
  if (issue === undefined) throw new Error('Missing issue fixture.');
  await db.insert(schema.cycleIssueMembership).values({
    id: newId(),
    organizationId: workspace.organizationId,
    teamId: input.teamId ?? issue.teamId,
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

async function stateActivity(
  issueId: string,
  fromState: { readonly id: string; readonly name: string },
  toState: { readonly id: string; readonly name: string },
  createdAt: string,
): Promise<void> {
  await db.insert(schema.issueActivity).values({
    id: newId(),
    organizationId: workspace.organizationId,
    issueId,
    actorType: 'user',
    actorId: workspace.adminUser.id,
    actorName: workspace.adminUser.name,
    field: 'stateId',
    fromValue: fromState,
    toValue: toState,
    createdAt: new Date(createdAt),
  });
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  await db.delete(schema.cycle);
});

describe('loadSprintAnalytics', () => {
  it('returns an empty state when the workspace has no sprint', async () => {
    const result = await loadSprintAnalytics(
      workspace.admin,
      analyticsQuerySchema.parse({ lens: 'sprints' }),
      { now: new Date('2026-01-02T12:00:00.000Z') },
    );

    expect(result.selected).toBeNull();
    expect(result.current).toBeNull();
    expect(result.previous).toBeNull();
    expect(result.velocity).toEqual([]);
    expect(result.flow.completed).toBe(0);
  });

  it('returns an empty state when the workspace only has an upcoming sprint', async () => {
    await cycle(1, '2026-02-01T00:00:00.000Z', '2026-02-08T00:00:00.000Z');

    const result = await loadSprintAnalytics(
      workspace.admin,
      analyticsQuerySchema.parse({ lens: 'sprints' }),
      { now: new Date('2026-01-02T12:00:00.000Z') },
    );

    expect(result.selected).toBeNull();
    expect(result.current).toBeNull();
    expect(result.velocity).toEqual([]);
  });

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

    expect(currentOf(result).burn.map((point) => point.date)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);
    expect(currentOf(result).burn.map((point) => point.remaining)).toEqual([1, 0, 0, 0, 0]);
    expect(currentOf(result).burn[1]?.completed).toBe(1);
    expect(result.formulas.burn).toContain('local calendar day');
  });

  it('marks dates before observed membership capture as unavailable', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-14T07:49:36.000Z',
      coverage: 'observed',
      entryKind: 'bootstrap',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    const burn = currentOf(result).burn;
    const past = burn.filter((point) => !point.future);

    expect(past.map((point) => point.available)).toEqual([false, false, false, true]);
    expect(burn.slice(0, 3).map((point) => point.scope)).toEqual([0, 0, 0]);
    expect(burn[3]?.scope).toBe(1);
    expect(burn[3]?.added).toBe(0);
    expect(burn[0]?.ideal).toBe(1);
    expect(burn[3]?.ideal).toBeCloseTo(6 / 9, 5);
    expect(currentOf(result).scopeChanges.added).toBe(0);
    expect(result.formulas.burn).toContain('unavailable rather than zero');
    expect(burn.map((point) => point.calendarDay)).toEqual(
      Array.from({ length: burn.length }, (_, index) => index + 1),
    );
  });

  it('holds the capture baseline cycle wide for a person scoped burn', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const ada = await addMember(workspace, 'member', { name: 'Ada' });
    const bootstrapped = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      assigneeId: workspace.adminUser.id,
    });
    const joinedAfterCapture = await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      assigneeId: ada.user.id,
    });
    await membership(cycleId, bootstrapped, {
      addedAt: '2026-08-14T07:00:00.000Z',
      coverage: 'observed',
      entryKind: 'bootstrap',
      assigneeId: workspace.adminUser.id,
    });
    await membership(cycleId, joinedAfterCapture, {
      addedAt: '2026-08-14T09:00:00.000Z',
      coverage: 'captured',
      entryKind: 'added',
      assigneeId: ada.user.id,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    const adaBurn = currentOf(result).people.find((entry) => entry.personId === ada.user.id)?.burn;

    expect(adaBurn).toBeDefined();
    expect(adaBurn?.filter((point) => !point.future).map((point) => point.available)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('reaches zero ideal remaining on the final included sprint day', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-11T00:00:00.000Z',
      coverage: 'captured',
      entryKind: 'added',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-24T23:59:00.000Z'),
    });
    const finalPoint = currentOf(result).burn.at(-1);

    expect(finalPoint?.date).toBe('2026-08-24');
    expect(finalPoint?.ideal).toBe(0);
  });

  it('stops the burn on the last included day of a completed midnight ending sprint', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z', {
      completedAt: '2026-08-25T00:00:00.000Z',
    });
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-11T00:00:00.000Z',
      coverage: 'captured',
      entryKind: 'added',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-26T12:00:00.000Z'),
    });
    const burn = currentOf(result).burn;

    expect(burn.at(-1)?.date).toBe('2026-08-24');
    expect(burn.some((point) => point.date === '2026-08-25')).toBe(false);
  });

  it('reaches zero ideal remaining on the last working day of a weekend ending sprint', async () => {
    const cycleId = await cycle(1, '2026-08-03T00:00:00.000Z', '2026-08-16T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-03T00:00:00.000Z',
      coverage: 'captured',
      entryKind: 'added',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-15T23:00:00.000Z'),
    });
    const burn = currentOf(result).burn;
    const lastWorkingDay = burn.find((point) => point.date === '2026-08-14');
    const weekendEnd = burn.at(-1);

    expect(weekendEnd?.date).toBe('2026-08-15');
    expect(weekendEnd?.workingDay).toBeNull();
    expect(lastWorkingDay?.workingDay).toBe(10);
    expect(lastWorkingDay?.ideal).toBe(0);
    expect(weekendEnd?.ideal).toBe(0);
  });

  it('applies visible issue filters to sprint scope without treating sprint selection as a filter', async () => {
    const cycleId = await cycle(1, '2026-03-01T00:00:00.000Z', '2026-03-15T00:00:00.000Z');
    const includedProject = await createProjectRow(workspace, 'Included');
    const excludedProject = await createProjectRow(workspace, 'Excluded');
    const included = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      projectId: includedProject,
    });
    const excluded = await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      projectId: excludedProject,
    });
    await membership(cycleId, included, { addedAt: '2026-02-28T00:00:00.000Z' });
    await membership(cycleId, excluded, { addedAt: '2026-02-28T00:00:00.000Z' });
    const query = analyticsQuerySchema.parse({
      lens: 'sprints',
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
          {
            kind: 'condition',
            property: 'project',
            operator: 'in',
            values: [includedProject],
            negate: false,
          },
        ],
      },
    });

    const result = await loadSprintAnalytics(workspace.admin, query, {
      now: new Date('2026-03-03T12:00:00.000Z'),
    });

    expect(currentOf(result).summary.currentScope).toBe(1);
    expect(currentOf(result).cohorts.planned).toEqual([included]);
  });

  it('bounds unusually long sprint histories while preserving the first and current day', async () => {
    const cycleId = await cycle(1, '2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
    const issueId = await insertIssue(workspace, { number: 1, state: 'Todo', cycleId });
    await membership(cycleId, issueId, { addedAt: '2019-12-31T00:00:00.000Z' });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    const burn = currentOf(result).burn;
    const past = burn.filter((point) => !point.future);

    expect(past.length).toBeLessThanOrEqual(120);
    expect(burn[0]?.date).toBe('2020-01-01');
    expect(past.at(-1)?.date).toBe('2026-08-14');
    expect(burn.at(-1)?.date).toBe('2029-12-31');
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

    expect(currentOf(result).scopeChanges).toMatchObject({ added: 2, removed: 2 });
    expect(currentOf(result).burn.map((point) => point.scope)).toEqual([1, 1, 1, 2, 1, 1, 0]);
    expect(currentOf(result).cohorts.removed).toContain(moved);
  });

  it('weights an unestimated membership addition as 1 point, matching the points-mode rule', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const estimated = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      estimate: 3,
    });
    const unestimated = await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      estimate: null,
    });
    await membership(cycleId, estimated, { addedAt: '2026-01-02T00:00:00.000Z', estimate: 3 });
    await membership(cycleId, unestimated, { addedAt: '2026-01-03T00:00:00.000Z', estimate: null });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId, 'points'), {
      now: new Date('2026-01-04T12:00:00.000Z'),
    });

    expect(currentOf(result).scopeChanges.added).toBe(4);
    const addDay = currentOf(result).burn.find((point) => point.date === '2026-01-03');
    expect(addDay?.added).toBe(1);
  });

  it('changes committed scope at known state transitions without applying current backlog backward', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const todo = stateNamed(workspace, 'Todo');
    const backlog = stateNamed(workspace, 'Backlog');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Backlog',
      cycleId,
      createdAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, { addedAt: '2025-12-20T00:00:00.000Z' });
    await stateActivity(issueId, todo, backlog, '2026-01-03T08:00:00.000Z');

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-05T12:00:00.000Z'),
    });

    expect(currentOf(result).burn.map((point) => point.scope)).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });

  it('enters committed scope only when a known backlog issue moves to Todo', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const todo = stateNamed(workspace, 'Todo');
    const backlog = stateNamed(workspace, 'Backlog');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, { addedAt: '2025-12-20T00:00:00.000Z' });
    await stateActivity(issueId, backlog, todo, '2026-01-03T08:00:00.000Z');

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-05T12:00:00.000Z'),
    });

    expect(currentOf(result).burn.map((point) => point.scope)).toEqual([0, 0, 1, 1, 1, 0, 0]);
  });

  it('shows a completion episode and burns back up when the issue reopens', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const todo = stateNamed(workspace, 'Todo');
    const done = stateNamed(workspace, 'Done');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2025-12-20T00:00:00.000Z'),
      completedAt: null,
    });
    await membership(cycleId, issueId, { addedAt: '2025-12-20T00:00:00.000Z' });
    await stateActivity(issueId, todo, done, '2026-01-02T08:00:00.000Z');
    await stateActivity(issueId, done, todo, '2026-01-04T08:00:00.000Z');

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-05T12:00:00.000Z'),
    });

    expect(currentOf(result).burn.map((point) => point.completed)).toEqual([0, 1, 1, 0, 0, 0, 0]);
    expect(currentOf(result).burn.map((point) => point.remaining)).toEqual([1, 0, 0, 1, 1, 0, 0]);
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

    expect(currentOf(issues).summary).toMatchObject({
      planned: 2,
      currentScope: 3,
      unestimated: 1,
    });
    expect(currentOf(points).summary).toMatchObject({
      planned: 13,
      currentScope: 9,
      unestimated: 1,
    });
    expect([...currentOf(issues).cohorts.planned].sort()).toEqual([planned, backlog].sort());
    expect(issues.coverage.kind).toBe('observed');
  });

  it('keeps work planned when it entered Todo before moving to backlog inside the planning window', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const todo = stateNamed(workspace, 'Todo');
    const backlog = stateNamed(workspace, 'Backlog');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Backlog',
      cycleId,
    });
    await membership(cycleId, issueId, { addedAt: '2026-01-01T02:00:00.000Z' });
    await stateActivity(issueId, todo, backlog, '2026-01-01T12:00:00.000Z');

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-02T12:00:00.000Z'),
    });

    expect(currentOf(result).cohorts.planned).toEqual([issueId]);
    expect(currentOf(result).summary.planned).toBe(1);
  });

  it('does not call work planned when it entered backlog before moving to Todo inside the window', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const todo = stateNamed(workspace, 'Todo');
    const backlog = stateNamed(workspace, 'Backlog');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
    });
    await membership(cycleId, issueId, { addedAt: '2026-01-01T02:00:00.000Z' });
    await stateActivity(issueId, backlog, todo, '2026-01-01T12:00:00.000Z');

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-02T12:00:00.000Z'),
    });

    expect(currentOf(result).cohorts.planned).toEqual([]);
    expect(currentOf(result).summary.planned).toBe(1);
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
    expect(result.focus?.burn.filter((point) => !point.future).at(-1)?.remaining).toBe(1);
    expect(currentOf(result).cohorts.carryover).toContain(previousIssue);
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

    expect(currentOf(result).summary.currentScope).toBe(5);
    expect(
      currentOf(result)
        .teams.map((team) => team.id)
        .sort(),
    ).toEqual([workspace.teamId, sibling.team.id].sort());
  });

  it('attributes historical scope to interval teams after an issue moves teams', async () => {
    const sibling = await createTeam(workspace.admin, { name: 'Platform', key: 'PLAT' });
    const [existingCycle] = await db
      .select()
      .from(schema.cycle)
      .where(eq(schema.cycle.organizationId, workspace.organizationId))
      .limit(1);
    if (existingCycle === undefined) throw new Error('Missing workspace sprint.');
    const cycleId = existingCycle.id;
    await db
      .update(schema.cycle)
      .set({
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-01-08T00:00:00.000Z'),
        timezone: 'UTC',
      })
      .where(eq(schema.cycle.id, cycleId));
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    const siblingTodo = sibling.states.find((state) => state.category === 'unstarted');
    if (siblingTodo === undefined) throw new Error('Missing sibling workflow state.');
    await db
      .update(schema.issue)
      .set({ teamId: sibling.team.id, stateId: siblingTodo.id })
      .where(eq(schema.issue.id, issueId));
    await membership(cycleId, issueId, {
      addedAt: '2025-12-20T00:00:00.000Z',
      removedAt: '2026-01-03T08:00:00.000Z',
      teamId: workspace.teamId,
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-01-03T08:00:00.000Z',
      teamId: sibling.team.id,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-05T12:00:00.000Z'),
    });
    const primary = currentOf(result).teams.find((team) => team.id === workspace.teamId);
    const moved = currentOf(result).teams.find((team) => team.id === sibling.team.id);

    expect(currentOf(result).teams).toHaveLength(2);
    expect(primary?.summary.currentScope).toBe(0);
    expect(moved?.summary.currentScope).toBe(1);
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

    expect(firstResult.focus?.burn.map((point) => point.remaining)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(secondResult.focus?.burn.map((point) => point.remaining)).toEqual([0, 0, 1, 1, 0, 0, 0]);
    expect(secondResult.focus?.summary.currentScope).toBe(1);
  });

  it('keeps completed sprint personal burn assigned to each person at the historical time', async () => {
    const first = await addMember(workspace, 'member', { name: 'Grace' });
    const second = await addMember(workspace, 'member', { name: 'Linus' });
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', {
      completedAt: '2026-01-08T00:00:00.000Z',
    });
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Done',
      cycleId: null,
      assigneeId: second.user.id,
      completedAt: new Date('2026-01-06T08:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2025-12-20T00:00:00.000Z',
      removedAt: '2026-01-08T00:00:00.000Z',
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
    await db.insert(schema.cycleIssueOutcome).values({
      id: newId(),
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      cycleId,
      issueId,
      issueIdentifier: 'NOV-1',
      planned: true,
      assigneeIdAtClose: second.user.id,
      outcome: 'completed',
      completedAt: new Date('2026-01-06T08:00:00.000Z'),
      closedAt: new Date('2026-01-08T00:00:00.000Z'),
    });
    await db.insert(schema.cycleProgressSnapshot).values({
      id: newId(),
      organizationId: workspace.organizationId,
      cycleId,
      capturedOn: '2026-01-08',
      isFinal: true,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-10T00:00:00.000Z'),
    });
    const firstBurn = currentOf(result).people.find((person) => person.personId === first.user.id);
    const secondBurn = currentOf(result).people.find(
      (person) => person.personId === second.user.id,
    );

    expect(firstBurn?.burn.map((point) => point.scope)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(secondBurn?.burn.map((point) => point.scope)).toEqual([0, 0, 1, 1, 1, 1, 1]);
    expect(result.coverage.kind).toBe('frozen');
  });

  it('returns an honest first-sprint state', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-02T12:00:00.000Z'),
    });
    expect(result.previous).toBeNull();
    expect(result.coverage.kind).toBe('observed');
  });

  it('selects a temporally previous sprint and bounds trustworthy velocity at asOf', async () => {
    const temporalPrevious = await cycle(
      99,
      '2025-12-20T00:00:00.000Z',
      '2025-12-27T00:00:00.000Z',
      { completedAt: '2025-12-27T00:00:00.000Z' },
    );
    await cycle(9, '2025-12-30T00:00:00.000Z', '2026-01-03T00:00:00.000Z', {
      completedAt: '2026-01-03T00:00:00.000Z',
    });
    const selectedId = await cycle(10, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    const futureClosed = await cycle(100, '2026-01-08T00:00:00.000Z', '2026-01-15T00:00:00.000Z', {
      completedAt: '2026-01-20T00:00:00.000Z',
    });
    const archived = await cycle(101, '2025-12-01T00:00:00.000Z', '2025-12-08T00:00:00.000Z', {
      completedAt: '2025-12-08T00:00:00.000Z',
    });
    await db
      .update(schema.cycle)
      .set({ archivedAt: new Date('2025-12-09T00:00:00.000Z') })
      .where(eq(schema.cycle.id, archived));

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(selectedId), {
      now: new Date('2026-01-05T12:00:00.000Z'),
    });

    expect(result.previous?.sprint.id).toBe(temporalPrevious);
    expect(result.velocity.map((point) => point.sprint.id)).not.toContain(futureClosed);
    expect(result.velocity.map((point) => point.sprint.id)).not.toContain(archived);
  });

  it('does not call a partial completed sprint frozen', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', {
      completedAt: '2026-01-08T00:00:00.000Z',
    });
    const first = await insertIssue(workspace, { number: 1, state: 'Done', cycleId: null });
    const second = await insertIssue(workspace, { number: 2, state: 'Todo', cycleId: null });
    await membership(cycleId, first, {
      addedAt: '2025-12-20T00:00:00.000Z',
      removedAt: '2026-01-08T00:00:00.000Z',
    });
    await membership(cycleId, second, {
      addedAt: '2025-12-20T00:00:00.000Z',
      removedAt: '2026-01-08T00:00:00.000Z',
    });
    await db.insert(schema.cycleIssueOutcome).values({
      id: newId(),
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      cycleId,
      issueId: first,
      issueIdentifier: 'NOV-1',
      planned: true,
      outcome: 'completed',
      completedAt: new Date('2026-01-04T00:00:00.000Z'),
      closedAt: new Date('2026-01-08T00:00:00.000Z'),
    });
    await db.insert(schema.cycleProgressSnapshot).values({
      id: newId(),
      organizationId: workspace.organizationId,
      cycleId,
      capturedOn: '2026-01-08',
      isFinal: true,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-10T00:00:00.000Z'),
    });

    expect(result.coverage.kind).not.toBe('frozen');
    expect(result.flow.cycleTimeCoverage).not.toBe('frozen');
  });

  it('extends the burn with ideal-only future points through sprint end', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-14T07:00:00.000Z',
      coverage: 'observed',
      entryKind: 'bootstrap',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    const burn = currentOf(result).burn;
    const past = burn.filter((point) => !point.future);
    const future = burn.filter((point) => point.future);

    expect(burn.at(-1)?.date).toBe('2026-08-24');
    expect(past.map((point) => point.date).at(-1)).toBe('2026-08-14');
    expect(future.every((point) => point.scope === 0 && point.remaining === 0)).toBe(true);
    expect(future.at(-1)?.ideal).toBe(0);
  });

  it('draws the ideal from day 1 at the retroactive baseline scope', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-14T07:00:00.000Z',
      coverage: 'observed',
      entryKind: 'bootstrap',
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    const burn = currentOf(result).burn;

    expect(burn[0]?.ideal).toBe(1);
    expect(burn[3]?.ideal).toBeCloseTo(6 / 9, 5);
    expect(currentOf(result).baseline).toEqual({
      date: '2026-08-14',
      scope: 1,
      retroactive: true,
    });
    expect(currentOf(result).summary.planned).toBe(1);
  });

  it('reports the counterpart measure summary alongside the requested one', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const estimated = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      estimate: 5,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const unestimated = await insertIssue(workspace, {
      number: 2,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, estimated, { addedAt: '2026-08-11T00:00:00.000Z', estimate: 5 });
    await membership(cycleId, unestimated, { addedAt: '2026-08-11T00:00:00.000Z' });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-12T12:00:00.000Z'),
    });

    expect(currentOf(result).summary.currentScope).toBe(2);
    expect(currentOf(result).counterpart.currentScope).toBe(6);
    expect(result.formulas.points).toContain('counts as 1 point');
  });

  it('does not duplicate the sprint start date when now predates the sprint start', async () => {
    const cycleId = await cycle(1, '2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z');
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await membership(cycleId, issueId, { addedAt: '2026-08-25T00:00:00.000Z' });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-20T12:00:00.000Z'),
      selectedSprintId: cycleId,
    });
    const burn = currentOf(result).burn;
    const dates = burn.map((point) => point.date);

    expect(new Set(dates).size).toBe(dates.length);
    expect(dates[0]).toBe('2026-09-01');
    expect(dates.at(-1)).toBe('2026-09-07');
    expect(dates.every((date) => date >= '2026-09-01')).toBe(true);
  });

  it('adopts each person own retroactive baseline for their planned total', async () => {
    const cycleId = await cycle(1, '2026-08-11T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    const member = await addMember(workspace, 'member', { name: 'Priya' });
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      assigneeId: member.user.id,
    });
    await membership(cycleId, issueId, {
      addedAt: '2026-08-14T07:00:00.000Z',
      coverage: 'observed',
      entryKind: 'bootstrap',
      assigneeId: member.user.id,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    const personSummary = currentOf(result).people.find(
      (entry) => entry.personId === member.user.id,
    )?.summary;

    expect(personSummary?.planned).toBe(1);
  });

  it('does not call completed outcomes frozen when a relevant membership is observed', async () => {
    const cycleId = await cycle(1, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', {
      completedAt: '2026-01-08T00:00:00.000Z',
    });
    const issueId = await insertIssue(workspace, { number: 1, state: 'Done', cycleId: null });
    await membership(cycleId, issueId, {
      addedAt: '2025-12-20T00:00:00.000Z',
      removedAt: '2026-01-08T00:00:00.000Z',
      coverage: 'observed',
      entryKind: 'bootstrap',
    });
    await db.insert(schema.cycleIssueOutcome).values({
      id: newId(),
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      cycleId,
      issueId,
      issueIdentifier: 'NOV-1',
      planned: false,
      outcome: 'completed',
      completedAt: new Date('2026-01-04T00:00:00.000Z'),
      closedAt: new Date('2026-01-08T00:00:00.000Z'),
    });
    await db.insert(schema.cycleProgressSnapshot).values({
      id: newId(),
      organizationId: workspace.organizationId,
      cycleId,
      capturedOn: '2026-01-08',
      isFinal: true,
    });

    const result = await loadSprintAnalytics(workspace.admin, sprintQuery(cycleId), {
      now: new Date('2026-01-10T00:00:00.000Z'),
    });

    expect(result.coverage.kind).toBe('reconstructed');
  });
});
