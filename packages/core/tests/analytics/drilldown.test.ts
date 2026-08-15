import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import {
  type AnalyticsQuery,
  analyticsDrilldownQuerySchema,
  analyticsQuerySchema,
} from '@orbit/shared';
import { listAnalyticsDrilldown } from '../../src/analytics/drilldown.ts';
import { createLabel, insertLabelOn } from '../../src/analytics/test-fixtures.ts';
import { newId } from '../../src/internal.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

const now = new Date('2026-08-13T12:00:00.000Z');

let workspace: Workspace;

function query(): AnalyticsQuery {
  return analyticsQuerySchema.parse({
    range: { preset: 'custom', from: '2026-08-01', to: '2026-08-10' },
    compare: 'none',
  });
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('listAnalyticsDrilldown', () => {
  it('paginates deterministically with an opaque keyset cursor and bounded limit', async () => {
    for (const title of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      await createIssue(workspace.admin, { teamId: workspace.teamId, title });
    }

    const first = await listAnalyticsDrilldown(
      workspace.admin,
      {
        query: query(),
        cohort: { cohort: 'current' },
        limit: 2,
      },
      { now, timezone: 'UTC' },
    );
    const second = await listAnalyticsDrilldown(
      workspace.admin,
      {
        query: query(),
        cohort: { cohort: 'current' },
        ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
        limit: 2,
      },
      { now, timezone: 'UTC' },
    );

    expect(first.total).toBe(4);
    expect(first.issues).toHaveLength(2);
    expect(second.issues).toHaveLength(2);
    expect(new Set([...first.issues, ...second.issues].map((entry) => entry.id)).size).toBe(4);
    expect(second.nextCursor).toBeNull();

    const bounded = await listAnalyticsDrilldown(
      workspace.admin,
      {
        query: query(),
        cohort: { cohort: 'current' },
        limit: 10_000,
      },
      { now, timezone: 'UTC' },
    );
    expect(bounded.limit).toBe(200);
  });

  it('rejects a cursor that belongs to a different cohort', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Issue' });
    const page = await listAnalyticsDrilldown(
      workspace.admin,
      {
        query: query(),
        cohort: { cohort: 'current' },
        limit: 1,
      },
      { now, timezone: 'UTC' },
    );

    await expect(
      listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query(),
          cohort: { cohort: 'created' },
          cursor: page.nextCursor ?? 'invalid',
          limit: 1,
        },
        { now, timezone: 'UTC' },
      ),
    ).rejects.toThrow();
  });

  it('rejects tampered cursors and reuse across query, date, and organization bindings', async () => {
    for (const title of ['First', 'Second']) {
      await createIssue(workspace.admin, { teamId: workspace.teamId, title });
    }
    const context = { now, timezone: 'UTC', cursorSecret: 'analytics-test-secret' };
    const page = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'current' }, limit: 1 },
      context,
    );
    if (page.nextCursor === null) throw new Error('Missing cursor.');
    const finalCharacter = page.nextCursor.at(-1);
    const tampered = `${page.nextCursor.slice(0, -1)}${finalCharacter === 'a' ? 'b' : 'a'}`;
    const changedQuery = analyticsQuerySchema.parse({ ...query(), measure: 'points' });
    const changedFilter = analyticsQuerySchema.parse({
      ...query(),
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
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
    const changedDate = analyticsQuerySchema.parse({
      ...query(),
      range: { preset: 'custom', from: '2026-08-02', to: '2026-08-11' },
    });
    const outside = await createWorkspace('Outside');

    for (const [principal, reusedQuery, cursor] of [
      [workspace.admin, query(), tampered],
      [workspace.admin, changedQuery, page.nextCursor],
      [workspace.admin, changedFilter, page.nextCursor],
      [workspace.admin, changedDate, page.nextCursor],
      [outside.admin, query(), page.nextCursor],
    ] as const) {
      await expect(
        listAnalyticsDrilldown(
          principal,
          {
            query: reusedQuery,
            cohort: { cohort: 'current' },
            cursor,
            limit: 1,
          },
          context,
        ),
      ).rejects.toThrow('cursor');
    }
  });

  it('keeps the authenticated first-page reporting snapshot across later requests', async () => {
    for (const title of ['First', 'Second', 'Third']) {
      await createIssue(workspace.admin, { teamId: workspace.teamId, title });
    }
    const cursorSecret = 'analytics-test-secret';
    const first = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'current' }, limit: 1 },
      { now, timezone: 'UTC', cursorSecret },
    );
    if (first.nextCursor === null) throw new Error('Missing cursor.');
    expect(() =>
      analyticsDrilldownQuerySchema.parse({
        ...query(),
        cohort: { cohort: 'current' },
        cursor: first.nextCursor,
        limit: 1,
      }),
    ).not.toThrow();

    const second = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'current' }, cursor: first.nextCursor, limit: 1 },
      { now: new Date('2026-08-14T12:00:00.000Z'), timezone: 'UTC', cursorSecret },
    );

    expect(second.asOf).toBe(first.asOf);
    expect(second.issues[0]?.id).not.toBe(first.issues[0]?.id);

    const [body, signature] = first.nextCursor.split('.');
    if (body === undefined || signature === undefined) throw new Error('Malformed cursor.');
    const decoded: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) throw new Error('Malformed cursor body.');
    if (!('resolution' in decoded)) throw new Error('Missing cursor resolution.');
    const resolution = decoded.resolution;
    if (typeof resolution !== 'object' || resolution === null) {
      throw new Error('Malformed cursor resolution.');
    }
    const changedBody = Buffer.from(
      JSON.stringify({
        ...decoded,
        resolution: { ...resolution, asOf: '2026-08-12T12:00:00.000Z' },
      }),
      'utf8',
    ).toString('base64url');

    await expect(
      listAnalyticsDrilldown(
        workspace.admin,
        {
          query: query(),
          cohort: { cohort: 'current' },
          cursor: `${changedBody}.${signature}`,
          limit: 1,
        },
        { now: new Date('2026-08-14T12:00:00.000Z'), timezone: 'UTC', cursorSecret },
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('drills into the workflow state category the overview distribution links to', async () => {
    const started = workspace.states.find((state) => state.category === 'started');
    if (started === undefined) throw new Error('Missing started state fixture.');
    const running = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Running',
    });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Waiting' });
    await db
      .update(schema.issue)
      .set({ stateId: started.id })
      .where(eq(schema.issue.id, running.issue.id));

    const page = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: `state-category:${started.category}` }, limit: 10 },
      { now, timezone: 'UTC' },
    );

    expect(page.issues.map((entry) => entry.title)).toEqual(['Running']);
  });

  it('drills into an assignee cohort, including the unassigned bucket', async () => {
    const member = await addMember(workspace, 'member', { name: 'Nadia' });
    const assigned = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Assigned',
      assigneeId: member.user.id,
    });
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Unassigned',
      assigneeId: null,
    });

    const assignedPage = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: `assignee:${member.user.id}` }, limit: 10 },
      { now, timezone: 'UTC' },
    );
    const nonePage = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'assignee:none' }, limit: 10 },
      { now, timezone: 'UTC' },
    );

    expect(assignedPage.issues.map((entry) => entry.title)).toEqual(['Assigned']);
    expect(assignedPage.issues[0]?.id).toBe(assigned.issue.id);
    expect(nonePage.issues.map((entry) => entry.title)).toEqual(['Unassigned']);
  });

  it('drills into a label cohort, including the unlabeled bucket', async () => {
    const labelId = await createLabel(workspace, 'Bug');
    const labeled = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Labeled',
    });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Unlabeled' });
    await insertLabelOn(labeled.issue.id, labelId);

    const labeledPage = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: `label:${labelId}` }, limit: 10 },
      { now, timezone: 'UTC' },
    );
    const nonePage = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'label:none' }, limit: 10 },
      { now, timezone: 'UTC' },
    );

    expect(labeledPage.issues.map((entry) => entry.title)).toEqual(['Labeled']);
    expect(nonePage.issues.map((entry) => entry.title)).toEqual(['Unlabeled']);
  });

  it('drills into a sprint cohort, including the no-sprint bucket', async () => {
    const cycleId = newId();
    await db.insert(schema.cycle).values({
      id: cycleId,
      organizationId: workspace.organizationId,
      number: 2,
      name: 'Sprint 2',
      timezone: 'UTC',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-08T00:00:00.000Z'),
    });
    const inSprint = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'In sprint',
      cycleId,
    });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'No sprint' });

    const sprintPage = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: `sprint:${cycleId}` }, limit: 10 },
      { now, timezone: 'UTC' },
    );
    const nonePage = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'sprint:none' }, limit: 10 },
      { now, timezone: 'UTC' },
    );

    expect(sprintPage.issues.map((entry) => entry.title)).toEqual(['In sprint']);
    expect(sprintPage.issues[0]?.id).toBe(inSprint.issue.id);
    expect(nonePage.issues.map((entry) => entry.title)).toEqual(['No sprint']);
  });

  it('drills into a created-week cohort by the date_trunc week bucket', async () => {
    const inWeek = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'In week',
    });
    const outOfWeek = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Out of week',
    });
    await db
      .update(schema.issue)
      .set({ createdAt: new Date('2026-08-10T12:00:00.000Z') })
      .where(eq(schema.issue.id, inWeek.issue.id));
    await db
      .update(schema.issue)
      .set({ createdAt: new Date('2026-08-17T12:00:00.000Z') })
      .where(eq(schema.issue.id, outOfWeek.issue.id));

    const page = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'created-week:2026-08-10' }, limit: 10 },
      { now, timezone: 'UTC' },
    );

    expect(page.issues.map((entry) => entry.title)).toEqual(['In week']);
  });

  it('drills into a completed-week cohort and excludes open issues implicitly', async () => {
    const completedInWeek = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Completed in week',
    });
    const completedOtherWeek = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Completed other week',
    });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Still open' });
    await db
      .update(schema.issue)
      .set({ completedAt: new Date('2026-08-10T12:00:00.000Z') })
      .where(eq(schema.issue.id, completedInWeek.issue.id));
    await db
      .update(schema.issue)
      .set({ completedAt: new Date('2026-08-17T12:00:00.000Z') })
      .where(eq(schema.issue.id, completedOtherWeek.issue.id));

    const page = await listAnalyticsDrilldown(
      workspace.admin,
      { query: query(), cohort: { cohort: 'completed-week:2026-08-10' }, limit: 10 },
      { now, timezone: 'UTC' },
    );

    expect(page.issues.map((entry) => entry.title)).toEqual(['Completed in week']);
  });

  it('rejects malformed semantic cohort keys before executing SQL', async () => {
    const invalidCohorts = [
      '',
      'priority:',
      'priority:nope',
      'priority:5',
      'priority:1.5',
      'state:',
      'state:none',
      'state:not-an-id',
      'state-category:',
      'state-category:nope',
      'state-category:Started',
      'project:',
      'project:not-an-id',
      'outlier:',
      'outlier:none',
      'outlier:not-an-id',
      'current:extra',
      'assignee:',
      'label:not-an-id',
      'sprint:',
      'created-week:junk',
      'completed-week:2026-13-99',
    ];

    for (const cohort of invalidCohorts) {
      await expect(
        listAnalyticsDrilldown(
          workspace.admin,
          { query: query(), cohort: { cohort }, limit: 1 },
          { now, timezone: 'UTC', cursorSecret: 'analytics-test-secret' },
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    }
  });
});
