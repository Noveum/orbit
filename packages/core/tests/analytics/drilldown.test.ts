import { beforeEach, describe, expect, it } from 'bun:test';
import {
  type AnalyticsQuery,
  analyticsDrilldownQuerySchema,
  analyticsQuerySchema,
} from '@orbit/shared';
import { listAnalyticsDrilldown } from '../../src/analytics/drilldown.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
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
      'project:',
      'project:not-an-id',
      'outlier:',
      'outlier:none',
      'outlier:not-an-id',
      'current:extra',
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
