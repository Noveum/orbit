import { beforeEach, describe, expect, it } from 'bun:test';
import { scopes } from '@orbit/shared/events';
import {
  createSavedAnalyticsView,
  deleteSavedAnalyticsView,
  updateSavedAnalyticsView,
} from '../../src/analytics/saved-view.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

const CONFIG = { kind: 'velocity' as const };

async function newView(shared: boolean) {
  return await createSavedAnalyticsView(workspace.admin, {
    name: 'Layoff modelling',
    config: CONFIG,
    shared,
  });
}

describe('a private analytics view', () => {
  it('is announced to its owner alone, not the whole workspace', async () => {
    const created = await newView(false);

    expect(created.actions[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
  });

  it('keeps its name and config off the organization channel', async () => {
    const created = await newView(false);

    const orgScope = scopes.organization(workspace.organizationId);
    for (const action of created.actions) {
      expect(action.scopes).not.toContain(orgScope);
    }
    expect(JSON.stringify(created.actions)).toContain('Layoff modelling');
  });

  it('stays private through an update', async () => {
    const created = await newView(false);

    const updated = await updateSavedAnalyticsView(workspace.admin, created.view.id, {
      name: 'Layoff modelling v2',
    });

    expect(updated.actions[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
  });

  it('stays private when it is deleted', async () => {
    const created = await newView(false);

    const actions = await deleteSavedAnalyticsView(workspace.admin, created.view.id);

    expect(actions[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
  });
});

describe('a shared analytics view', () => {
  it('reaches the workspace', async () => {
    const created = await newView(true);

    expect(created.actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
    expect(created.actions[0]?.scopes).toContain(scopes.user(workspace.admin.userId));
  });

  it('is withdrawn from the workspace when it is unshared', async () => {
    const created = await newView(true);

    const updated = await updateSavedAnalyticsView(workspace.admin, created.view.id, {
      shared: false,
    });

    expect(updated.actions[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
    const withdrawal = updated.actions.find((action) => action.action === 'delete');
    expect(withdrawal?.scopes).toEqual([scopes.organization(workspace.organizationId)]);
    expect(JSON.stringify(withdrawal?.data)).not.toContain('Layoff modelling');
  });

  it('does not send a withdrawal when it stays shared', async () => {
    const created = await newView(true);

    const updated = await updateSavedAnalyticsView(workspace.admin, created.view.id, {
      name: 'Still shared',
    });

    expect(updated.actions.filter((action) => action.action === 'delete')).toHaveLength(0);
  });
});
