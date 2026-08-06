import { beforeEach, describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import {
  addMember,
  createWorkspace,
  reaches,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createView, deleteView, listViews, updateView } from '../../src/work/view-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function privateInput(name: string) {
  return { name, filter: { groupBy: 'state', visibility: 'private' } };
}

function sharedInput(name: string) {
  return { name, filter: { groupBy: 'state', visibility: 'workspace' } };
}

function only(actions: readonly SyncAction[]): SyncAction {
  const [action] = actions;
  if (action === undefined) throw new Error('no sync action was published');
  return action;
}

describe('a saved view only reaches the people who can open it', () => {
  it('keeps a private view on its owner scope alone', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, privateInput('My work'));

    const insert = only(created.actions);
    expect(insert.scopes).toEqual([scopes.user(workspace.admin.userId)]);
    expect(insert.scopes).not.toContain(scopes.organization(workspace.organizationId));
    expect(reaches(colleague, insert)).toBe(false);
    expect(reaches(workspace.admin, insert)).toBe(true);
  });

  it('keeps every later delta of a private view off the workspace scope', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, privateInput('My work'));

    const renamed = await updateView(workspace.admin, created.view.id, { name: 'Still mine' });
    const removed = await deleteView(workspace.admin, created.view.id);

    for (const action of [...renamed.actions, ...removed]) {
      expect(action.scopes).not.toContain(scopes.organization(workspace.organizationId));
      expect(reaches(colleague, action)).toBe(false);
      expect(reaches(workspace.admin, action)).toBe(true);
    }
  });

  it('never carries the filter of a private view in a delta anyone else receives', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, privateInput('Layoff planning'));

    const insert = only(created.actions);
    expect(JSON.stringify(insert.data)).toContain('Layoff planning');
    expect(reaches(colleague, insert)).toBe(false);
  });

  it('still announces a shared view to the whole workspace', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, sharedInput('Team triage'));

    const insert = only(created.actions);
    expect(insert.scopes).toContain(scopes.organization(workspace.organizationId));
    expect(reaches(colleague, insert)).toBe(true);

    const renamed = await updateView(workspace.admin, created.view.id, { name: 'Triage' });
    expect(reaches(colleague, only(renamed.actions))).toBe(true);
    expect((await listViews(colleague)).some((view) => view.id === created.view.id)).toBe(true);
  });

  it('tells the workspace a view is gone when its owner makes it private', async () => {
    const { principal: colleague } = await addMember(workspace, 'member', { name: 'Colleague' });
    const created = await createView(workspace.admin, sharedInput('Team triage'));

    const { actions } = await updateView(workspace.admin, created.view.id, {
      filter: { ...created.view.state, visibility: 'private' },
    });

    const forEveryoneElse = actions.filter((action) => reaches(colleague, action));
    expect(forEveryoneElse).toHaveLength(1);
    expect(forEveryoneElse[0]?.action).toBe('delete');
    expect(JSON.stringify(forEveryoneElse[0]?.data)).not.toContain('Team triage');
    expect((await listViews(colleague)).some((view) => view.id === created.view.id)).toBe(false);

    const forTheOwner = actions.filter((action) => action.action !== 'delete');
    expect(forTheOwner).toHaveLength(1);
    expect(forTheOwner[0]?.scopes).toEqual([scopes.user(workspace.admin.userId)]);
  });
});
