import { beforeEach, describe, expect, it } from 'bun:test';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { activeCycle } from '../work/cycle-service.ts';
import {
  createCheckpoint,
  createSavedAnalyticsView,
  deleteSavedAnalyticsView,
  listCheckpoints,
  listSavedAnalyticsViews,
  updateSavedAnalyticsView,
} from './saved-view.ts';
import { insertIssue } from './test-fixtures.ts';

let workspace: Workspace;
let cycleId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const cycle = await activeCycle(workspace.admin, workspace.teamId);
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
