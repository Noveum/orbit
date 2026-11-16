import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { analyticsQuerySchema } from '@orbit/shared';
import { resolveOverviewQuery } from '../../src/analytics/drilldown.ts';
import { loadAnalyticsOverview } from '../../src/analytics/overview.ts';
import { loadSprintAnalytics } from '../../src/analytics/sprints.ts';
import { createWorkspace, resetDatabase } from '../../src/test-support.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('stored profile reporting timezones', () => {
  it.each([
    { stored: 'UTC+8', timezone: 'Etc/GMT-8', from: '2026-07-31T16:00:00.000Z' },
    { stored: 'UTC+3', timezone: 'Etc/GMT-3', from: '2026-07-31T21:00:00.000Z' },
    { stored: 'UTC+1', timezone: 'Etc/GMT-1', from: '2026-07-31T23:00:00.000Z' },
    { stored: 'Unknown/Timezone', timezone: 'UTC', from: '2026-08-01T00:00:00.000Z' },
  ])(
    'serves reports for stored $stored without changing its intended offset',
    async ({ stored, timezone, from }) => {
      const workspace = await createWorkspace('Timezone');
      await db
        .update(schema.user)
        .set({ timezone: stored })
        .where(eq(schema.user.id, workspace.admin.userId));
      const query = analyticsQuerySchema.parse({
        range: { preset: 'custom', from: '2026-08-01', to: '2026-08-10' },
        compare: 'none',
      });
      const now = new Date('2026-08-11T12:00:00Z');
      const resolved = await resolveOverviewQuery(workspace.admin, query, { now });
      expect(resolved.timezone).toBe(timezone);
      expect(resolved.from.toISOString()).toBe(from);
      const overview = await loadAnalyticsOverview(workspace.admin, query, { now });
      expect(overview.resolvedRange.from).toBe(from);
      await expect(loadSprintAnalytics(workspace.admin, query, { now })).resolves.toBeDefined();
      const [person] = await db
        .select({ timezone: schema.user.timezone })
        .from(schema.user)
        .where(eq(schema.user.id, workspace.admin.userId));
      expect(person?.timezone).toBe(stored);
    },
  );
});
