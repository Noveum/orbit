import { beforeEach, describe, expect, it } from 'bun:test';
import { db } from '@orbit/db';
import { conditionsOf, inCondition, VIRTUAL_VIEW_IDS } from '@orbit/shared/filters';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../test-support.ts';
import { createIssue } from './issue-service.ts';
import { createLabel, deleteLabel, listLabels, updateLabel } from './label-service.ts';
import type { ViewRecord } from './view-service.ts';
import { createView, deleteView, listViews, setViewFavorite, updateView } from './view-service.ts';
import {
  createWorkflowState,
  defaultStateFor,
  deleteWorkflowState,
  listWorkflowStates,
  reorderWorkflowStates,
  updateWorkflowState,
} from './workflow-state-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('workflow states', () => {
  it('lists the seven bootstrap states in position order', async () => {
    const states = await listWorkflowStates(workspace.admin, workspace.teamId);
    expect(states.map((state) => state.category)).toEqual([
      'triage',
      'backlog',
      'unstarted',
      'started',
      'review',
      'completed',
      'canceled',
    ]);
  });

  it('resolves a default state for a category', async () => {
    const started = await defaultStateFor(db, workspace.teamId, 'started');
    expect(started?.name).toBe('In Progress');
  });

  it('creates, updates, and reorders states', async () => {
    const created = await createWorkflowState(workspace.admin, {
      teamId: workspace.teamId,
      name: 'Blocked',
      category: 'started',
      color: '#EF4444',
    });
    expect(created.state.position).toBe(7);
    expect(created.actions[0]?.model).toBe('workflow_state');

    const renamed = await updateWorkflowState(workspace.admin, created.state.id, {
      name: 'On hold',
    });
    expect(renamed.state.name).toBe('On hold');
    expect(renamed.state.category).toBe('started');

    const ids = (await listWorkflowStates(workspace.admin, workspace.teamId))
      .map((state) => state.id)
      .reverse();
    const reordered = await reorderWorkflowStates(workspace.admin, workspace.teamId, ids);
    expect(reordered.states).toHaveLength(8);
    const after = await listWorkflowStates(workspace.admin, workspace.teamId);
    expect(after.map((state) => state.id)).toEqual(ids);
  });

  it('refuses to delete a state that still holds issues', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Parked' });
    await expect(
      deleteWorkflowState(workspace.admin, stateNamed(workspace, 'Todo').id),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('deletes an empty state', async () => {
    const actions = await deleteWorkflowState(workspace.admin, stateNamed(workspace, 'Triage').id);
    expect(actions[0]?.action).toBe('delete');
    expect(await listWorkflowStates(workspace.admin, workspace.teamId)).toHaveLength(6);
  });

  it('refuses a contributor', async () => {
    const { principal } = await addMember(workspace, 'contributor');
    await expect(
      createWorkflowState(principal, {
        teamId: workspace.teamId,
        name: 'Nope',
        category: 'started',
        color: '#EF4444',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('labels', () => {
  it('creates, updates, lists, and deletes', async () => {
    const created = await createLabel(workspace.admin, { name: 'Regression', color: '#EF4444' });
    expect(created.label.teamId).toBeNull();

    const scoped = await updateLabel(workspace.admin, created.label.id, {
      teamId: workspace.teamId,
    });
    expect(scoped.label.teamId).toBe(workspace.teamId);
    expect(scoped.label.name).toBe('Regression');

    const all = await listLabels(workspace.admin);
    expect(all.some((label) => label.name === 'Regression')).toBe(true);

    await deleteLabel(workspace.admin, created.label.id);
    expect((await listLabels(workspace.admin)).some((l) => l.name === 'Regression')).toBe(false);
  });
});

describe('views', () => {
  it('creates a private view, updates it, and hides it from others', async () => {
    const created = await createView(workspace.admin, {
      name: 'My work',
      filter: {
        filter: { kind: 'group', combinator: 'and', children: [inCondition('assignee', ['x'])] },
        groupBy: 'state',
      },
    });
    expect(created.view.shared).toBe(false);
    expect(created.view.layout).toBe('list');
    expect(created.view.virtual).toBe(false);

    const updated = await updateView(workspace.admin, created.view.id, {
      filter: { ...created.view.state, layout: 'board' },
    });
    expect(updated.view.layout).toBe('board');
    expect(updated.view.name).toBe('My work');
    expect(updated.view.groupBy).toBe('state');

    const { principal } = await addMember(workspace, 'member');
    expect(saved(await listViews(principal))).toHaveLength(0);

    await updateView(workspace.admin, created.view.id, {
      filter: { ...created.view.state, layout: 'board', visibility: 'workspace' },
    });
    expect(saved(await listViews(principal))).toHaveLength(1);

    await deleteView(workspace.admin, created.view.id);
    expect(saved(await listViews(workspace.admin))).toHaveLength(0);
  });

  it('injects the four built-in views for every viewer and refuses to change them', async () => {
    const views = await listViews(workspace.admin);
    const builtIn = views.filter((view) => view.virtual);
    expect(builtIn.map((view) => view.id)).toEqual([...VIRTUAL_VIEW_IDS]);

    const assigned = builtIn.find((view) => view.id === 'virtual:assigned');
    expect(
      conditionsOf(assigned?.state.filter ?? { kind: 'group', combinator: 'and', children: [] }),
    ).toEqual([inCondition('assignee', [workspace.admin.userId])]);

    await expect(updateView(workspace.admin, 'virtual:all', { name: 'Nope' })).rejects.toThrow();
    await expect(deleteView(workspace.admin, 'virtual:all')).rejects.toThrow();
  });

  it('stars a view, sorts it first, and refuses to delete a locked one', async () => {
    const plain = await createView(workspace.admin, {
      name: 'Zebra',
      filter: { groupBy: 'state' },
    });
    const locked = await createView(workspace.admin, {
      name: 'Alpha',
      filter: { groupBy: 'state', locked: true },
    });

    await setViewFavorite(workspace.admin, plain.view.id, { favorite: true });
    const starred = saved(await listViews(workspace.admin));
    expect(starred[0]?.name).toBe('Zebra');
    expect(starred[0]?.favorite).toBe(true);

    await expect(deleteView(workspace.admin, locked.view.id)).rejects.toThrow();

    await setViewFavorite(workspace.admin, plain.view.id, { favorite: false });
    expect(saved(await listViews(workspace.admin))[0]?.name).toBe('Alpha');
  });
});

function saved(views: readonly ViewRecord[]): ViewRecord[] {
  return views.filter((view) => !view.virtual);
}
