import { beforeEach, describe, expect, it } from 'bun:test';
import { analyticsQuerySchema, insightConfigSchema } from '@orbit/shared/validators';
import {
  createCheckpoint,
  createSavedAnalyticsView,
  deleteSavedAnalyticsView,
  listCheckpoints,
  listSavedAnalyticsViews,
  savedAnalyticsQuery,
  updateSavedAnalyticsView,
} from '../../src/analytics/saved-view.ts';
import { insertIssue } from '../../src/analytics/test-fixtures.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { activeCycle } from '../../src/work/cycle-service.ts';

let workspace: Workspace;
let cycleId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const cycle = await activeCycle(workspace.admin);
  if (cycle === undefined) throw new Error('expected a bootstrap active cycle');
  cycleId = cycle.id;
});

describe('saved analytics views', () => {
  it('persists a saved view and publishes a realtime action', async () => {
    const { view, actions } = await createSavedAnalyticsView(workspace.admin, {
      name: 'Assignee load',
      config: { xAxis: 'assignee', measure: 'issues' },
    });
    expect(actions[0]?.model).toBe('view');

    const listed = await listSavedAnalyticsViews(workspace.admin);
    expect(listed.map((row) => row.id)).toContain(view.id);
    expect(listed.find((row) => row.id === view.id)?.name).toBe('Assignee load');
  });

  it('restores the complete versioned planning query', async () => {
    const query = analyticsQuerySchema.parse({
      version: 1,
      lens: 'people',
      range: { preset: 'custom', from: '2026-08-01', to: '2026-08-14' },
      compare: 'previous_period',
      measure: 'points',
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'project',
            operator: 'in',
            values: ['00000000-0000-7000-8000-000000000001'],
            negate: false,
          },
        ],
      },
      includeArchived: true,
      includeCanceled: false,
      focus: { personId: workspace.admin.userId },
    });
    const { view } = await createSavedAnalyticsView(workspace.admin, {
      name: 'My launch work',
      config: { kind: 'dashboard', version: 1, query, pinned: true },
    });

    expect(savedAnalyticsQuery(view)).toEqual({
      kind: 'dashboard',
      version: 1,
      query,
      pinned: true,
    });
  });

  it('keeps the insight config alongside the query for an insights lens view', async () => {
    const query = analyticsQuerySchema.parse({ lens: 'insights' });
    const insight = insightConfigSchema.parse({
      measure: 'points',
      slice: 'assignee',
      segment: 'state',
    });
    const { view } = await createSavedAnalyticsView(workspace.admin, {
      name: 'Points by assignee',
      config: { kind: 'dashboard', version: 1, query, insight, pinned: false },
    });

    expect(savedAnalyticsQuery(view)).toEqual({
      kind: 'dashboard',
      version: 1,
      query,
      insight,
      pinned: false,
    });
  });

  it('migrates a legacy measure-only dashboard to version one defaults', async () => {
    const { view } = await createSavedAnalyticsView(workspace.admin, {
      name: 'Legacy points',
      config: { measure: 'points' },
    });

    expect(savedAnalyticsQuery(view)).toMatchObject({
      kind: 'dashboard',
      version: 1,
      query: { lens: 'overview', measure: 'points', range: { preset: 'auto' } },
      pinned: false,
    });
  });

  it('keeps one pinned default for each owner', async () => {
    const query = analyticsQuerySchema.parse({ lens: 'projects' });
    const { view: first } = await createSavedAnalyticsView(workspace.admin, {
      name: 'First default',
      config: { kind: 'dashboard', version: 1, query, pinned: true },
    });
    const { view: second } = await createSavedAnalyticsView(workspace.admin, {
      name: 'Second default',
      config: { kind: 'dashboard', version: 1, query, pinned: true },
    });

    const listed = await listSavedAnalyticsViews(workspace.admin);
    const firstListed = listed.find((row) => row.id === first.id);
    const secondListed = listed.find((row) => row.id === second.id);
    if (firstListed === undefined || secondListed === undefined) {
      throw new Error('expected both saved views to be listed');
    }
    expect(savedAnalyticsQuery(firstListed)?.pinned).toBe(false);
    expect(savedAnalyticsQuery(secondListed)?.pinned).toBe(true);
  });

  it('renames a saved view through its owner', async () => {
    const { view } = await createSavedAnalyticsView(workspace.admin, { name: 'Draft' });
    const { view: renamed } = await updateSavedAnalyticsView(workspace.admin, view.id, {
      name: 'Cycle health',
    });
    expect(renamed.name).toBe('Cycle health');
  });

  it('refuses a saved view for a role without view:manage', async () => {
    const guest = await addMember(workspace, 'guest', { name: 'Gus Guest' });
    await expect(createSavedAnalyticsView(guest.principal, { name: 'Nope' })).rejects.toMatchObject(
      { code: 'forbidden' },
    );
  });

  it('archives a saved view so it stops listing', async () => {
    const { view } = await createSavedAnalyticsView(workspace.admin, { name: 'Temp' });
    await deleteSavedAnalyticsView(workspace.admin, view.id);
    const listed = await listSavedAnalyticsViews(workspace.admin);
    expect(listed.map((row) => row.id)).not.toContain(view.id);
  });
});

describe('checkpoints', () => {
  it('captures cycle numbers that do not drift when the data changes later', async () => {
    await insertIssue(workspace, { number: 1, state: 'Done', cycleId, completedAt: new Date() });
    await insertIssue(workspace, { number: 2, state: 'In Progress', cycleId });

    await createCheckpoint(workspace.admin, { cycleId, label: 'Mid sprint' });
    const [before] = await listCheckpoints(workspace.admin, cycleId);
    expect(before?.label).toBe('Mid sprint');
    expect(before?.scope).toBe(2);
    expect(before?.completed).toBe(1);
    expect(before?.remaining).toBe(1);

    await insertIssue(workspace, { number: 3, state: 'Done', cycleId });
    await insertIssue(workspace, { number: 4, state: 'Todo', cycleId });

    const [after] = await listCheckpoints(workspace.admin, cycleId);
    expect(after?.scope).toBe(2);
    expect(after?.completed).toBe(1);
    expect(after?.remaining).toBe(1);
  });
});
