import { beforeEach, describe, expect, it } from 'bun:test';
import { asc, db, eq, schema } from '@orbit/db';
import { isOpenCategory } from '@orbit/shared/constants';
import { scopes } from '@orbit/shared/events';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';
import { createLabel } from '../../src/work/label-service.ts';
import {
  createWorkflowState,
  DEFAULT_WORKFLOW_STATES,
  deleteWorkflowState,
  listWorkflowStates,
  listWorkflowStatesForTeams,
  reorderWorkflowStates,
  updateWorkflowState,
  type WorkflowStateRow,
} from '../../src/work/workflow-state-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    const thrown = error as { code?: unknown };
    return typeof thrown.code === 'string' ? thrown.code : 'not-a-domain-error';
  }
  throw new Error('the call was expected to throw and did not');
}

async function issueById(issueId: string) {
  const [row] = await db.select().from(schema.issue).where(eq(schema.issue.id, issueId)).limit(1);
  if (row === undefined) throw new Error('the issue vanished');
  return row;
}

async function statesOf(teamId: string): Promise<WorkflowStateRow[]> {
  return await db
    .select()
    .from(schema.workflowState)
    .where(eq(schema.workflowState.teamId, teamId))
    .orderBy(asc(schema.workflowState.position));
}

describe('the board order is the server position, contiguous and complete', () => {
  it('appends a new status after the last one and ignores a position the caller sends', async () => {
    const created = await createWorkflowState(workspace.admin, {
      teamId: workspace.teamId,
      name: 'Blocked',
      category: 'started',
      color: '#EF4444',
      position: 0,
    });

    const defaults = DEFAULT_WORKFLOW_STATES.length;
    expect(created.state.position).toBe(defaults);
    expect((await statesOf(workspace.teamId)).map((state) => state.position)).toEqual(
      Array.from({ length: defaults + 1 }, (_, index) => index),
    );
  });

  it('refuses an order that leaves a status out, so no two columns collide', async () => {
    const before = await statesOf(workspace.teamId);
    const subset = before.slice(0, 3).map((state) => state.id);

    expect(
      await errorOf(() =>
        reorderWorkflowStates(workspace.admin, { teamId: workspace.teamId, stateIds: subset }),
      ),
    ).toBe('conflict');

    expect((await statesOf(workspace.teamId)).map((state) => state.id)).toEqual(
      before.map((state) => state.id),
    );
  });

  it('refuses an order that names one status twice', async () => {
    const before = await statesOf(workspace.teamId);
    const doubled = before.map((state) => state.id);
    doubled[1] = doubled[0] ?? '';

    expect(
      await errorOf(() =>
        reorderWorkflowStates(workspace.admin, { teamId: workspace.teamId, stateIds: doubled }),
      ),
    ).toBe('validation_failed');

    expect((await statesOf(workspace.teamId)).map((state) => state.id)).toEqual(
      before.map((state) => state.id),
    );
  });

  it('refuses an order that smuggles in a status from another team', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const mine = await statesOf(workspace.teamId);
    const theirs = await statesOf(design.team.id);
    const mixed = [...mine.slice(1).map((state) => state.id), theirs[0]?.id ?? ''];

    expect(
      await errorOf(() =>
        reorderWorkflowStates(workspace.admin, { teamId: workspace.teamId, stateIds: mixed }),
      ),
    ).toBe('conflict');

    expect((await statesOf(design.team.id)).map((state) => state.position)).toEqual(
      theirs.map((state) => state.position),
    );
  });

  it('renumbers every status when the whole order is given, and keeps each category', async () => {
    const before = await statesOf(workspace.teamId);
    const flipped = before.map((state) => state.id).reverse();

    const result = await reorderWorkflowStates(workspace.admin, {
      teamId: workspace.teamId,
      stateIds: flipped,
    });

    const after = await statesOf(workspace.teamId);
    expect(after.map((state) => state.id)).toEqual(flipped);
    expect(after.map((state) => state.position)).toEqual(
      Array.from({ length: DEFAULT_WORKFLOW_STATES.length }, (_, index) => index),
    );
    expect(new Map(after.map((state) => [state.id, state.category]))).toEqual(
      new Map(before.map((state) => [state.id, state.category])),
    );
    expect(result.actions).toHaveLength(before.length);
    expect(result.actions.every((action) => action.scopes.length === 1)).toBe(true);
    expect(result.actions[0]?.scopes).toEqual([scopes.team(workspace.teamId)]);
  });
});

describe('a status carries a category the rest of the product reads', () => {
  it('re-dates the issues sitting in a status when its category moves to completed', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    expect((await issueById(created.issue.id)).completedAt).toBeNull();

    const saved = await updateWorkflowState(workspace.admin, todo.id, { category: 'completed' });

    const after = await issueById(created.issue.id);
    expect(saved.state.category).toBe('completed');
    expect(after.completedAt).not.toBeNull();
    expect(after.startedAt).not.toBeNull();
    expect(saved.actions.some((action) => action.model === 'issue')).toBe(true);
  });

  it('clears the completion when the category moves back off completed', async () => {
    const done = stateNamed(workspace, 'Done');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Shipped',
      stateId: done.id,
    });
    expect((await issueById(created.issue.id)).completedAt).not.toBeNull();

    await updateWorkflowState(workspace.admin, done.id, { category: 'unstarted' });

    const after = await issueById(created.issue.id);
    expect(after.completedAt).toBeNull();
    expect(after.startedAt).toBeNull();
  });

  it('leaves the issues alone when only the name and the colour change', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    const before = await issueById(created.issue.id);

    const saved = await updateWorkflowState(workspace.admin, todo.id, {
      name: 'Up next',
      color: '#123456',
    });

    const after = await issueById(created.issue.id);
    expect(saved.state.name).toBe('Up next');
    expect(saved.state.category).toBe('unstarted');
    expect(after.syncId).toBe(before.syncId);
    expect(saved.actions.some((action) => action.model === 'issue')).toBe(false);
  });

  it('keeps the age of an issue that never moved when only the category is renamed', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    const before = await issueById(created.issue.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await updateWorkflowState(workspace.admin, todo.id, { category: 'backlog' });

    const after = await issueById(created.issue.id);
    expect(after.stateId).toBe(todo.id);
    expect(after.stateEnteredAt.getTime()).toBe(before.stateEnteredAt.getTime());
  });

  it('restarts the age of an issue that really was carried to another status', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const done = stateNamed(workspace, 'Done');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    const before = await issueById(created.issue.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await deleteWorkflowState(workspace.admin, todo.id, { moveToStateId: done.id });

    const after = await issueById(created.issue.id);
    expect(after.stateId).toBe(done.id);
    expect(after.stateEnteredAt.getTime()).toBeGreaterThan(before.stateEnteredAt.getTime());
  });

  it('answers a patch that changes nothing with no action and no sync id bump', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });

    const empty = await updateWorkflowState(workspace.admin, todo.id, {});
    const same = await updateWorkflowState(workspace.admin, todo.id, {
      name: todo.name,
      category: 'unstarted',
      color: todo.color,
    });

    expect(empty.actions).toHaveLength(0);
    expect(same.actions).toHaveLength(0);
    expect((await statesOf(workspace.teamId)).find((s) => s.id === todo.id)?.syncId).toBe(
      todo.syncId,
    );
    expect((await issueById(created.issue.id)).syncId).toBe(created.issue.syncId);
  });

  it('never births a new issue into a closed column when the open ones are gone', async () => {
    const board = await statesOf(workspace.teamId);
    for (const state of board) {
      if (state.name === 'In Review') continue;
      await updateWorkflowState(workspace.admin, state.id, { category: 'completed' });
    }
    await updateWorkflowState(workspace.admin, stateNamed(workspace, 'In Review').id, {
      category: 'review',
    });

    const created = await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'New' });

    const landed = await issueById(created.issue.id);
    expect(landed.stateId).toBe(stateNamed(workspace, 'In Review').id);
    expect(landed.completedAt).toBeNull();
  });

  it('still takes the first column when a team has closed every one of them', async () => {
    const board = await statesOf(workspace.teamId);
    const first = board[0];
    if (first === undefined) throw new Error('the fixture had no states');
    for (const state of board) {
      await updateWorkflowState(workspace.admin, state.id, { category: 'canceled' });
    }

    const created = await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'New' });

    expect((await issueById(created.issue.id)).stateId).toBe(first.id);
  });

  it('refuses two statuses of the same name on one team', async () => {
    expect(
      await errorOf(() =>
        createWorkflowState(workspace.admin, {
          teamId: workspace.teamId,
          name: 'Todo',
          category: 'unstarted',
          color: '#EF4444',
        }),
      ),
    ).toBe('conflict');
  });

  it('publishes a status change to the team only, never to the whole workspace', async () => {
    const saved = await updateWorkflowState(workspace.admin, stateNamed(workspace, 'Todo').id, {
      name: 'Up next',
    });

    expect(saved.actions[0]?.scopes).toEqual([scopes.team(workspace.teamId)]);
    expect(saved.actions[0]?.scopes).not.toContain(scopes.organization(workspace.organizationId));
  });
});

describe('deleting a status that still holds issues needs an answer', () => {
  it('refuses when no replacement is named and leaves every issue where it was', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });

    expect(await errorOf(() => deleteWorkflowState(workspace.admin, todo.id))).toBe('conflict');

    expect((await issueById(created.issue.id)).stateId).toBe(todo.id);
    expect((await statesOf(workspace.teamId)).map((state) => state.id)).toContain(todo.id);
  });

  it('moves the issues to the named status, re-dates them, and records the move', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const done = stateNamed(workspace, 'Done');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });

    const actions = await deleteWorkflowState(workspace.admin, todo.id, {
      moveToStateId: done.id,
    });

    const after = await issueById(created.issue.id);
    expect(after.stateId).toBe(done.id);
    expect(after.completedAt).not.toBeNull();
    expect((await statesOf(workspace.teamId)).map((state) => state.id)).not.toContain(todo.id);
    expect(actions.filter((action) => action.model === 'issue')).toHaveLength(1);

    const activity = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.issueId, created.issue.id));
    expect(activity.some((row) => row.field === 'stateId' && row.toValue === 'Done')).toBe(true);
  });

  it('refuses a replacement that belongs to another team and keeps the status', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    const theirs = await statesOf(design.team.id);

    expect(
      await errorOf(() =>
        deleteWorkflowState(workspace.admin, todo.id, { moveToStateId: theirs[0]?.id ?? '' }),
      ),
    ).toBe('validation_failed');

    expect((await issueById(created.issue.id)).stateId).toBe(todo.id);
  });

  it('refuses to empty a team of statuses altogether', async () => {
    const states = await statesOf(workspace.teamId);
    for (const state of states.slice(1)) {
      await deleteWorkflowState(workspace.admin, state.id);
    }
    const last = states[0];
    if (last === undefined) throw new Error('the fixture had no states');

    expect(await errorOf(() => deleteWorkflowState(workspace.admin, last.id))).toBe('conflict');

    expect(await statesOf(workspace.teamId)).toHaveLength(1);
  });
});

describe('an issue a status change touches goes out whole, labels and all', () => {
  it('carries the labels through a category change, so a board cannot blank the chips', async () => {
    const label = await createLabel(workspace.admin, { name: 'Flaky', color: '#EF4444' });
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
      labelIds: [label.label.id],
    });

    const saved = await updateWorkflowState(workspace.admin, todo.id, { category: 'completed' });

    const action = saved.actions.find(
      (entry) => entry.model === 'issue' && entry.modelId === created.issue.id,
    );
    expect(action?.data['labelIds']).toEqual([label.label.id]);
  });

  it('carries them through a delete that moves the issues too', async () => {
    const label = await createLabel(workspace.admin, { name: 'Flaky', color: '#EF4444' });
    const todo = stateNamed(workspace, 'Todo');
    const done = stateNamed(workspace, 'Done');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Parked',
      stateId: todo.id,
      labelIds: [label.label.id],
    });

    const actions = await deleteWorkflowState(workspace.admin, todo.id, { moveToStateId: done.id });

    const action = actions.find(
      (entry) => entry.model === 'issue' && entry.modelId === created.issue.id,
    );
    expect(action?.data['labelIds']).toEqual([label.label.id]);
  });

  it('sends an empty list rather than nothing for an issue that carries no label', async () => {
    const todo = stateNamed(workspace, 'Todo');
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Bare',
      stateId: todo.id,
    });

    const saved = await updateWorkflowState(workspace.admin, todo.id, { category: 'completed' });

    const action = saved.actions.find(
      (entry) => entry.model === 'issue' && entry.modelId === created.issue.id,
    );
    expect(action?.data['labelIds']).toEqual([]);
  });
});

describe('the server is the gate, whatever the caller sends', () => {
  it('refuses a contributor on every write', async () => {
    const { principal } = await addMember(workspace, 'contributor');
    const todo = stateNamed(workspace, 'Todo');
    const ids = (await statesOf(workspace.teamId)).map((state) => state.id);

    expect(
      await errorOf(() =>
        createWorkflowState(principal, {
          teamId: workspace.teamId,
          name: 'Nope',
          category: 'started',
          color: '#EF4444',
        }),
      ),
    ).toBe('forbidden');
    expect(await errorOf(() => updateWorkflowState(principal, todo.id, { name: 'Nope' }))).toBe(
      'forbidden',
    );
    expect(await errorOf(() => deleteWorkflowState(principal, todo.id))).toBe('forbidden');
    expect(
      await errorOf(() =>
        reorderWorkflowStates(principal, { teamId: workspace.teamId, stateIds: ids.reverse() }),
      ),
    ).toBe('forbidden');
  });

  it('refuses a member of this workspace who is not on that team', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const outsider = await addMember(workspace, 'member', { teamIds: [workspace.teamId] });
    const theirs = await statesOf(design.team.id);
    const target = theirs[0];
    if (target === undefined) throw new Error('the new team had no states');

    expect(
      await errorOf(() => updateWorkflowState(outsider.principal, target.id, { name: 'Nope' })),
    ).toBe('forbidden');
    expect(await errorOf(() => deleteWorkflowState(outsider.principal, target.id))).toBe(
      'forbidden',
    );
    expect((await listWorkflowStates(workspace.admin, design.team.id))[0]?.name).toBe(target.name);
  });

  it('never answers a batch read with a team the caller has not joined', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const vega = await createWorkspace('Vega');
    const outsider = await addMember(workspace, 'member', { teamIds: [workspace.teamId] });

    const asked = await listWorkflowStatesForTeams(outsider.principal, [
      workspace.teamId,
      design.team.id,
      vega.teamId,
    ]);

    expect(new Set(asked.map((state) => state.teamId))).toEqual(new Set([workspace.teamId]));
    expect(asked).toHaveLength(DEFAULT_WORKFLOW_STATES.length);
  });

  it('gives an admin every team it asks for and still stops at the workspace edge', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const vega = await createWorkspace('Vega');

    const asked = await listWorkflowStatesForTeams(workspace.admin, [
      workspace.teamId,
      design.team.id,
      vega.teamId,
    ]);

    expect(new Set(asked.map((state) => state.teamId))).toEqual(
      new Set([workspace.teamId, design.team.id]),
    );
  });

  it('refuses a status in another workspace outright', async () => {
    const vega = await createWorkspace('Vega');
    const theirs = await statesOf(vega.teamId);
    const target = theirs[0];
    if (target === undefined) throw new Error('the other workspace had no states');

    expect(
      await errorOf(() => updateWorkflowState(workspace.admin, target.id, { name: 'Stolen' })),
    ).toBe('not_found');
    expect(await errorOf(() => deleteWorkflowState(workspace.admin, target.id))).toBe('not_found');
    expect((await statesOf(vega.teamId))[0]?.name).toBe(target.name);
  });
});

describe('the statuses a new team starts with', () => {
  it('includes a Duplicate status, so a repeat report can be closed as one', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const names = design.states.map((state) => state.name);

    expect(names).toContain('Duplicate');
  });

  it('files Duplicate as canceled, so it closes the issue and leaves the open counts alone', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const duplicate = design.states.find((state) => state.name === 'Duplicate');

    expect(duplicate?.category).toBe('canceled');
    expect(isOpenCategory(duplicate?.category ?? 'unstarted')).toBe(false);
  });

  it('keeps Duplicate last on the board, after Canceled', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const ordered = [...design.states].sort((left, right) => left.position - right.position);
    const names = ordered.map((state) => state.name);

    expect(names.at(-1)).toBe('Duplicate');
    expect(names.indexOf('Duplicate')).toBeGreaterThan(names.indexOf('Canceled'));
  });

  it('gives Duplicate its own position on the board rather than reusing the Canceled one', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const positions = design.states.map((state) => state.position);

    expect(new Set(positions).size).toBe(design.states.length);
  });
});
