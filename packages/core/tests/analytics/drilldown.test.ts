import { beforeEach, describe, expect, it } from 'bun:test';
import { type AnalyticsQuery, analyticsQuerySchema } from '@orbit/shared';
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
    const changedDate = analyticsQuerySchema.parse({
      ...query(),
      range: { preset: 'custom', from: '2026-08-02', to: '2026-08-11' },
    });
    const outside = await createWorkspace('Outside');

    for (const [principal, reusedQuery, cursor] of [
      [workspace.admin, query(), tampered],
      [workspace.admin, changedQuery, page.nextCursor],
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
});
