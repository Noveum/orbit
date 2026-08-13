import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { analyticsKeys } from '../../../src/features/analytics/analytics-keys.ts';
import { dehydratedAnalyticsLens } from '../../../src/features/analytics/data.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('analytics server hydration', () => {
  it('puts only the active clean-URL lens into the query cache', async () => {
    const query = analyticsQuerySchema.parse({});

    const state = await dehydratedAnalyticsLens(workspace.admin, query);

    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.queryKey).toEqual(analyticsKeys.lens('overview', query));
    expect(state.queries[0]?.state.data).toMatchObject({ lens: 'overview' });
  });

  it('hydrates a schema-valid empty sprint lens', async () => {
    await db.delete(schema.cycle);
    const query = analyticsQuerySchema.parse({ lens: 'sprints' });

    const state = await dehydratedAnalyticsLens(workspace.admin, query);

    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]?.state.data).toMatchObject({
      lens: 'sprints',
      selected: null,
      current: null,
    });
  });
});
