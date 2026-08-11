import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { scopes } from '@orbit/shared/events';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ZodError } from 'zod';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { createCycle } from '../../src/work/cycle-service.ts';
import {
  archiveIssue,
  bulkUpdateIssues,
  columnFacetsSql,
  createIssue,
  deleteIssue,
  getIssue,
  getIssueCounts,
  getIssueFacets,
  getIssueSummary,
  listIssues,
  listRelatedIssues,
  listRelations,
  listSubscribers,
  moveIssue,
  REBALANCE_THRESHOLD,
  removeRelation,
  setRelation,
  subscribe,
  unsubscribe,
  updateIssue,
} from '../../src/work/issue-service.ts';
import { createMilestone } from '../../src/work/milestone-service.ts';
import { createProject } from '../../src/work/project-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newIssue(title: string, overrides: Record<string, unknown> = {}) {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title,
    ...overrides,
  });
  return issue;
}

describe('createIssue', () => {
  it('allocates sequential identifiers and defaults to the first unstarted state', async () => {
    const first = await newIssue('First');
    const second = await newIssue('Second');

    expect(first.identifier).toBe('NOVA-1');
    expect(second.identifier).toBe('NOVA-2');
    expect(first.stateId).toBe(stateNamed(workspace, 'Todo').id);
    expect(first.creatorId).toBe(workspace.admin.userId);
  });

  it('allocates unique numbers under concurrency', async () => {
    const created = await Promise.all(
      Array.from({ length: 20 }, (_value, index) =>
        createIssue(workspace.admin, { teamId: workspace.teamId, title: `Race ${index}` }),
      ),
    );

    const identifiers = new Set(created.map((result) => result.issue.identifier));
    const numbers = created.map((result) => result.issue.number).sort((a, b) => a - b);
    expect(identifiers.size).toBe(20);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_value, index) => index + 1));
  });

  it('stacks new issues at the top of the column', async () => {
    const first = await newIssue('First');
    const second = await newIssue('Second');
    expect(second.sortOrder).toBeLessThan(first.sortOrder);
  });

  it('subscribes the creator and assignee, applies labels, and writes an activity row', async () => {
    const { user: assignee } = await addMember(workspace, 'member');
    const [label] = await db
      .select()
      .from(schema.label)
      .where(eq(schema.label.organizationId, workspace.organizationId))
      .limit(1);
    if (label === undefined) throw new Error('missing starter label');

    const issue = await newIssue('Wired', { assigneeId: assignee.id, labelIds: [label.id] });

    const subscribers = await listSubscribers(workspace.admin, issue.id);
    expect(subscribers.map((row) => row.userId).sort()).toEqual(
      [workspace.admin.userId, assignee.id].sort(),
    );

    const labels = await db
      .select()
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, issue.id));
    expect(labels).toHaveLength(1);

    const activity = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.issueId, issue.id));
    expect(activity).toHaveLength(1);
    expect(activity[0]?.field).toBe('created');
  });

  it('scopes a sync action to the team and the issue, never to the whole organization', async () => {
    const { issue, actions } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Scoped',
    });

    expect(actions).toHaveLength(1);
    const action = actions[0];
    expect(action?.model).toBe('issue');
    expect(action?.action).toBe('insert');
    expect(action?.syncId).toBeGreaterThan(0);
    expect(action?.scopes).toEqual(
      expect.arrayContaining([scopes.team(workspace.teamId), scopes.issue(issue.id)]),
    );
    expect(action?.scopes).not.toContain(scopes.organization(workspace.organizationId));
    expect(action?.actor.id).toBe(workspace.admin.userId);
    expect(() => new Date(action?.at ?? '')).not.toThrow();
  });
});

describe('permissions', () => {
  it('stops a guest from creating an issue', async () => {
    const { principal } = await addMember(workspace, 'guest');
    await expect(
      createIssue(principal, { teamId: workspace.teamId, title: 'Nope' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('stops a guest from deleting an issue', async () => {
    const issue = await newIssue('Guarded');
    const { principal } = await addMember(workspace, 'guest');
    await expect(deleteIssue(principal, issue.id)).rejects.toBeInstanceOf(DomainError);
  });

  it('lets a contributor update but not delete', async () => {
    const issue = await newIssue('Guarded');
    const { principal } = await addMember(workspace, 'contributor');

    const updated = await updateIssue(principal, issue.id, { title: 'Renamed' });
    expect(updated.issue.title).toBe('Renamed');

    await expect(deleteIssue(principal, issue.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets an admin delete', async () => {
    const issue = await newIssue('Doomed');
    const actions = await deleteIssue(workspace.admin, issue.id);
    expect(actions[0]?.action).toBe('delete');
    await expect(getIssue(workspace.admin, issue.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('refuses a member of another team even though delete is in their role', async () => {
    const issue = await newIssue('Someone else team work');
    const outsider = await addMember(workspace, 'member', { teamIds: [] });

    await expect(deleteIssue(outsider.principal, issue.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await getIssue(workspace.admin, issue.id)).toMatchObject({ id: issue.id });
  });
});

describe('deleteIssue and sub issues', () => {
  it('promotes children to top level and announces each one so no cache points at the gone row', async () => {
    const parent = await newIssue('Parent');
    const child = await newIssue('Child');
    const other = await newIssue('Unrelated');
    await updateIssue(workspace.admin, child.id, { parentId: parent.id });

    const actions = await deleteIssue(workspace.admin, parent.id);

    const [survivor] = await db.select().from(schema.issue).where(eq(schema.issue.id, child.id));
    expect(survivor?.parentId).toBeNull();

    const announced = actions.filter((action) => action.action === 'update');
    expect(announced.map((action) => action.modelId)).toEqual([child.id]);
    expect(announced[0]?.data['parentId']).toBeNull();
    expect(announced[0]?.syncId).toBe(actions[0]?.syncId ?? -1);
    expect(actions.map((action) => action.modelId)).not.toContain(other.id);

    const remaining = await listIssues(workspace.admin, {});
    expect(remaining.issues.map((issue) => issue.id).sort()).toEqual([child.id, other.id].sort());
  });

  it('bumps the child sync id past the stale one every open tab is holding', async () => {
    const parent = await newIssue('Parent');
    const child = await newIssue('Child');
    const attached = await updateIssue(workspace.admin, child.id, { parentId: parent.id });

    const actions = await deleteIssue(workspace.admin, parent.id);

    const announced = actions.find((action) => action.modelId === child.id);
    expect(announced?.data['syncId']).toBeGreaterThan(attached.issue.syncId);
  });
});

describe('updateIssue', () => {
  it('records one activity row per changed field and skips unchanged fields', async () => {
    const issue = await newIssue('Original');
    const { changes } = await updateIssue(workspace.admin, issue.id, {
      title: 'Changed',
      priority: 2,
      description: '',
    });

    expect(changes.map((change) => change.field).sort()).toEqual(['priority', 'title']);
    const activity = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.issueId, issue.id));
    expect(activity).toHaveLength(3);
  });

  it('returns no actions when nothing changed', async () => {
    const issue = await newIssue('Static');
    const result = await updateIssue(workspace.admin, issue.id, { title: 'Static' });
    expect(result.actions).toEqual([]);
  });

  it('sets startedAt when entering a started state and keeps it on completion', async () => {
    const issue = await newIssue('Timeline');
    expect(issue.startedAt).toBeNull();

    const started = await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'In Progress').id,
    });
    expect(started.issue.startedAt).not.toBeNull();
    expect(started.issue.completedAt).toBeNull();

    const done = await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    expect(done.issue.completedAt).not.toBeNull();
    expect(done.issue.startedAt?.getTime()).toBe(started.issue.startedAt?.getTime());
    expect(done.issue.canceledAt).toBeNull();
  });

  it('sets canceledAt and clears completedAt when canceled', async () => {
    const issue = await newIssue('Dropped');
    await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const canceled = await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });
    expect(canceled.issue.canceledAt).not.toBeNull();
    expect(canceled.issue.completedAt).toBeNull();
  });

  it('clears timestamps when moved back to backlog', async () => {
    const issue = await newIssue('Rewound');
    await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    const back = await updateIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'Backlog').id,
    });
    expect(back.issue.startedAt).toBeNull();
    expect(back.issue.completedAt).toBeNull();
    expect(back.issue.stateEnteredAt.getTime()).toBeGreaterThanOrEqual(issue.createdAt.getTime());
  });
});

describe('assignee membership', () => {
  it('refuses to create an issue assigned to somebody outside the workspace', async () => {
    const outside = await createWorkspace('Elsewhere');

    await expect(
      createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Assigned to a stranger',
        assigneeId: outside.admin.userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses to reassign an issue to somebody outside the workspace', async () => {
    const outside = await createWorkspace('Elsewhere');
    const issue = await newIssue('Ours');

    await expect(
      updateIssue(workspace.admin, issue.id, { assigneeId: outside.admin.userId }),
    ).rejects.toThrow();
  });

  it('refuses to move an issue onto somebody outside the workspace', async () => {
    const outside = await createWorkspace('Elsewhere');
    const issue = await newIssue('Ours');

    await expect(
      moveIssue(workspace.admin, issue.id, { assigneeId: outside.admin.userId }),
    ).rejects.toThrow();
  });

  it('still accepts a member of the same workspace', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Colleague' });
    const issue = await newIssue('Ours');

    const updated = await updateIssue(workspace.admin, issue.id, { assigneeId: user.id });

    expect(updated.issue.assigneeId).toBe(user.id);
  });

  it('still accepts clearing the assignee', async () => {
    const { user } = await addMember(workspace, 'member', { name: 'Colleague' });
    const issue = await newIssue('Ours', { assigneeId: user.id });

    const cleared = await updateIssue(workspace.admin, issue.id, { assigneeId: null });

    expect(cleared.issue.assigneeId).toBeNull();
  });
});

describe('label deltas', () => {
  async function starterLabel() {
    const [label] = await db
      .select()
      .from(schema.label)
      .where(eq(schema.label.organizationId, workspace.organizationId))
      .limit(1);
    if (label === undefined) throw new Error('missing starter label');
    return label;
  }

  function labelIdsOf(action: { data: Record<string, unknown> }): unknown {
    return action.data['labelIds'];
  }

  it('carries the new labels on the update action so other clients can apply them', async () => {
    const label = await starterLabel();
    const issue = await newIssue('Labelled later');

    const updated = await updateIssue(workspace.admin, issue.id, { labelIds: [label.id] });

    const action = updated.actions[0];
    if (action === undefined) throw new Error('no action published');
    expect(labelIdsOf(action)).toEqual([label.id]);
  });

  it('carries the remaining labels when one is taken off', async () => {
    const label = await starterLabel();
    const issue = await newIssue('Labelled', { labelIds: [label.id] });

    const cleared = await updateIssue(workspace.admin, issue.id, { labelIds: [] });

    const action = cleared.actions[0];
    if (action === undefined) throw new Error('no action published');
    expect(labelIdsOf(action)).toEqual([]);
  });

  it('carries labels on an update that does not touch them, so a new subscriber renders them', async () => {
    const label = await starterLabel();
    const issue = await newIssue('Renamed', { labelIds: [label.id] });

    const renamed = await updateIssue(workspace.admin, issue.id, { title: 'Renamed again' });

    const action = renamed.actions[0];
    if (action === undefined) throw new Error('no action published');
    expect(labelIdsOf(action)).toEqual([label.id]);
  });

  it('carries labels when the issue is moved', async () => {
    const label = await starterLabel();
    const issue = await newIssue('Dragged', { labelIds: [label.id] });

    const moved = await moveIssue(workspace.admin, issue.id, {});

    const action = moved.actions[0];
    if (action === undefined) throw new Error('no action published');
    expect(labelIdsOf(action)).toEqual([label.id]);
  });

  it('carries labels when the issue is archived', async () => {
    const label = await starterLabel();
    const issue = await newIssue('Filed away', { labelIds: [label.id] });

    const archived = await archiveIssue(workspace.admin, issue.id);

    const action = archived.actions[0];
    if (action === undefined) throw new Error('no action published');
    expect(labelIdsOf(action)).toEqual([label.id]);
  });
});

describe('moveIssue', () => {
  it('places an issue between two neighbours', async () => {
    const top = await newIssue('Top');
    const bottom = await newIssue('Bottom');
    const mover = await newIssue('Mover');

    const lower = top.sortOrder < bottom.sortOrder ? top : bottom;
    const upper = top.sortOrder < bottom.sortOrder ? bottom : top;

    const moved = await moveIssue(workspace.admin, mover.id, {
      beforeId: lower.id,
      afterId: upper.id,
    });

    expect(moved.issue.sortOrder).toBeGreaterThan(lower.sortOrder);
    expect(moved.issue.sortOrder).toBeLessThan(upper.sortOrder);
    expect(moved.rebalanced).toHaveLength(0);
  });

  it('rebalances the column when the gap collapses', async () => {
    const anchor = await newIssue('Anchor');
    const neighbour = await newIssue('Neighbour');
    const mover = await newIssue('Mover');

    await db.update(schema.issue).set({ sortOrder: 1000 }).where(eq(schema.issue.id, anchor.id));
    await db
      .update(schema.issue)
      .set({ sortOrder: 1000 + REBALANCE_THRESHOLD / 4 })
      .where(eq(schema.issue.id, neighbour.id));

    const moved = await moveIssue(workspace.admin, mover.id, {
      beforeId: anchor.id,
      afterId: neighbour.id,
    });

    expect(moved.rebalanced.length).toBeGreaterThan(0);
    const [refreshedAnchor] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, anchor.id));
    const [refreshedNeighbour] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, neighbour.id));
    expect(
      Math.abs((refreshedNeighbour?.sortOrder ?? 0) - (refreshedAnchor?.sortOrder ?? 0)),
    ).toBeGreaterThan(REBALANCE_THRESHOLD);
    expect(moved.issue.sortOrder).toBeGreaterThan(refreshedAnchor?.sortOrder ?? 0);
    expect(moved.issue.sortOrder).toBeLessThan(refreshedNeighbour?.sortOrder ?? 0);
  });

  it('reallocates the identifier when moved to another team', async () => {
    const issue = await newIssue('Transferred');
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const target = states.find((state) => state.category === 'unstarted');
    if (target === undefined) throw new Error('missing target state');

    const moved = await moveIssue(workspace.admin, issue.id, {
      teamId: team.id,
      stateId: target.id,
      beforeId: null,
      afterId: null,
    });

    expect(moved.issue.teamId).toBe(team.id);
    expect(moved.issue.identifier).toBe('DSGN-1');
    expect(moved.issue.number).toBe(1);
    expect(moved.actions[0]?.scopes).toContain(scopes.team(team.id));
  });

  it('moves an issue into a sprint without touching its status', async () => {
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2030-02-01').toISOString(),
      endsAt: new Date('2030-02-15').toISOString(),
    });
    const issue = await newIssue('Planned');
    expect(issue.cycleId).toBeNull();

    const moved = await moveIssue(workspace.admin, issue.id, { cycleId: cycle.id });

    expect(moved.issue.cycleId).toBe(cycle.id);
    expect(moved.issue.stateId).toBe(issue.stateId);
  });

  it('takes an issue back out of its sprint', async () => {
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2030-03-01').toISOString(),
      endsAt: new Date('2030-03-15').toISOString(),
    });
    const issue = await newIssue('Descoped', { cycleId: cycle.id });

    const moved = await moveIssue(workspace.admin, issue.id, { cycleId: null });

    expect(moved.issue.cycleId).toBeNull();
    expect(moved.issue.stateId).toBe(issue.stateId);
  });

  it('records the sprint change in the issue history', async () => {
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2030-04-01').toISOString(),
      endsAt: new Date('2030-04-15').toISOString(),
    });
    const issue = await newIssue('Tracked');

    await moveIssue(workspace.admin, issue.id, { cycleId: cycle.id });

    const entries = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.issueId, issue.id));
    expect(entries.some((entry) => entry.field === 'cycleId')).toBe(true);
  });

  it('refuses a sprint that belongs to another team', async () => {
    const { team } = await createTeam(workspace.admin, { name: 'Ops', key: 'OPS' });
    const { cycle } = await createCycle(workspace.admin, {
      teamId: team.id,
      startsAt: new Date('2030-05-01').toISOString(),
      endsAt: new Date('2030-05-15').toISOString(),
    });
    const issue = await newIssue('Wrong team sprint');

    await expect(moveIssue(workspace.admin, issue.id, { cycleId: cycle.id })).rejects.toThrow();
  });

  it('drops the sprint and project links that belong to the team it left', async () => {
    const { cycle } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: new Date('2030-01-01').toISOString(),
      endsAt: new Date('2030-01-15').toISOString(),
    });
    const { project } = await createProject(workspace.admin, {
      name: 'Engineering only',
      teamIds: [workspace.teamId],
    });
    const issue = await newIssue('Transferred', { cycleId: cycle.id, projectId: project.id });
    expect(issue.cycleId).toBe(cycle.id);
    expect(issue.projectId).toBe(project.id);

    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const target = states.find((state) => state.category === 'unstarted');
    if (target === undefined) throw new Error('missing target state');

    const moved = await moveIssue(workspace.admin, issue.id, {
      teamId: team.id,
      stateId: target.id,
      beforeId: null,
      afterId: null,
    });

    expect(moved.issue.teamId).toBe(team.id);
    expect(moved.issue.cycleId).toBeNull();
    expect(moved.issue.projectId).toBeNull();
    expect(moved.issue.milestoneId).toBeNull();
  });

  it('keeps a project that spans the destination team', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const target = states.find((state) => state.category === 'unstarted');
    if (target === undefined) throw new Error('missing target state');
    const { project } = await createProject(workspace.admin, {
      name: 'Cross team',
      teamIds: [workspace.teamId, team.id],
    });
    const issue = await newIssue('Shared work', { projectId: project.id });

    const moved = await moveIssue(workspace.admin, issue.id, {
      teamId: team.id,
      stateId: target.id,
      beforeId: null,
      afterId: null,
    });
    expect(moved.issue.projectId).toBe(project.id);
  });

  it('applies state timestamps when moving across columns', async () => {
    const issue = await newIssue('Crossing');
    const moved = await moveIssue(workspace.admin, issue.id, {
      stateId: stateNamed(workspace, 'In Progress').id,
      beforeId: null,
      afterId: null,
    });
    expect(moved.issue.startedAt).not.toBeNull();
    expect(moved.actions[0]?.scopes).toContain(scopes.issue(issue.id));
  });
});

describe('listIssues', () => {
  it('filters by state category, assignee, label, and text', async () => {
    const { user: assignee } = await addMember(workspace, 'member');
    const done = await newIssue('Shipped thing', { assigneeId: assignee.id });
    await updateIssue(workspace.admin, done.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });
    await newIssue('Backlog thing');

    const completed = await listIssues(workspace.admin, { stateCategory: 'completed' });
    expect(completed.issues.map((issue) => issue.id)).toEqual([done.id]);

    const assigned = await listIssues(workspace.admin, { assigneeId: assignee.id });
    expect(assigned.issues).toHaveLength(1);

    const searched = await listIssues(workspace.admin, { query: 'backlog' });
    expect(searched.issues.map((issue) => issue.title)).toEqual(['Backlog thing']);

    const byIdentifier = await listIssues(workspace.admin, { query: 'NOVA-1' });
    expect(byIdentifier.issues[0]?.identifier).toBe('NOVA-1');
  });

  it('leaves the description out of list rows and keeps it for an explicit full select', async () => {
    await newIssue('Heavy issue', { description: 'A body long enough to matter on the wire.' });

    const listed = await listIssues(workspace.admin, {});
    const row = listed.issues[0];
    expect(row?.description).toBeUndefined();

    const full = await listIssues(workspace.admin, { select: 'full' });
    expect(full.issues[0]?.description).toBe('A body long enough to matter on the wire.');
  });

  it('omits the columns no list surface reads so the page stays small on the wire', async () => {
    await newIssue('Wire weight');

    const [row] = (await listIssues(workspace.admin, {})).issues;
    expect(row).toBeDefined();
    for (const column of ['organizationId', 'description', 'estimatePointId', 'stateEnteredAt']) {
      expect(Object.hasOwn(row ?? {}, column)).toBe(false);
    }
    expect(row?.id).toBeDefined();
    expect(row?.sortOrder).toBeDefined();
  });

  it('hides archived issues unless asked', async () => {
    const issue = await newIssue('Old news');
    await archiveIssue(workspace.admin, issue.id);

    const hidden = await listIssues(workspace.admin, {});
    expect(hidden.issues).toHaveLength(0);

    const shown = await listIssues(workspace.admin, { includeArchived: true });
    expect(shown.issues).toHaveLength(1);
  });

  it('hides sub-issues when includeSubIssues is false', async () => {
    const parent = await newIssue('Parent');
    const child = await newIssue('Child');
    await updateIssue(workspace.admin, child.id, { parentId: parent.id });

    const flat = await listIssues(workspace.admin, { includeSubIssues: false });
    expect(flat.issues.map((issue) => issue.id)).toEqual([parent.id]);

    const nested = await listIssues(workspace.admin, { includeSubIssues: true });
    expect(nested.issues).toHaveLength(2);
  });

  it('orders by priority with no priority last', async () => {
    const none = await newIssue('No priority');
    const urgent = await newIssue('Urgent', { priority: 1 });
    const low = await newIssue('Low', { priority: 4 });

    const ordered = await listIssues(workspace.admin, { orderBy: 'priority' });
    expect(ordered.issues.map((issue) => issue.id)).toEqual([urgent.id, low.id, none.id]);
  });

  it('pages with a keyset cursor without repeating rows', async () => {
    for (let index = 0; index < 5; index += 1) {
      await newIssue(`Paged ${index}`);
    }

    const first = await listIssues(workspace.admin, { limit: 2, orderBy: 'created' });
    expect(first.issues).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listIssues(workspace.admin, {
      limit: 2,
      orderBy: 'created',
      cursor: first.nextCursor ?? undefined,
    });
    const seen = new Set([...first.issues, ...second.issues].map((issue) => issue.id));
    expect(seen.size).toBe(4);
  });

  it('counts issues by state for board headers', async () => {
    const first = await newIssue('One');
    await newIssue('Two');
    await updateIssue(workspace.admin, first.id, {
      stateId: stateNamed(workspace, 'Done').id,
    });

    const counts = await getIssueCounts(workspace.admin, { teamId: workspace.teamId });
    const byState = new Map(counts.map((row) => [row.stateId, row.total]));
    expect(byState.get(stateNamed(workspace, 'Done').id)).toBe(1);
    expect(byState.get(stateNamed(workspace, 'Todo').id)).toBe(1);
  });
});

describe('getIssueSummary', () => {
  it('reports the filtered total beside the unfiltered scope, so nothing has to be crawled', async () => {
    const mine = await newIssue('Mine');
    await newIssue('Theirs');
    await newIssue('Also theirs');
    await updateIssue(workspace.admin, mine.id, { assigneeId: workspace.admin.userId });

    const summary = await getIssueSummary(workspace.admin, {
      teamId: workspace.teamId,
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'assignee',
            operator: 'in',
            values: [workspace.admin.userId],
            negate: false,
          },
        ],
      },
    });

    expect(summary.total).toBe(1);
    expect((await getIssueFacets(workspace.admin, { teamId: workspace.teamId })).scopeTotal).toBe(
      3,
    );
  });

  it('counts every facet value across the whole scope, not just a loaded page', async () => {
    const done = await newIssue('Shipped');
    await newIssue('Waiting');
    await updateIssue(workspace.admin, done.id, {
      stateId: stateNamed(workspace, 'Done').id,
      assigneeId: workspace.admin.userId,
      estimate: 3,
    });

    const { facets } = await getIssueFacets(workspace.admin, { teamId: workspace.teamId });

    expect(facets.state[stateNamed(workspace, 'Done').id]).toBe(1);
    expect(facets.state[stateNamed(workspace, 'Todo').id]).toBe(1);
    expect(facets.assignee[workspace.admin.userId]).toBe(1);
    expect(facets.assignee['none']).toBe(1);
    expect(facets.creator[workspace.admin.userId]).toBe(2);
    expect(facets.priority['0']).toBe(2);
    expect(facets.estimate['3']).toBe(1);
    expect(facets.estimate['none']).toBe(1);
    expect(facets.project['none']).toBe(2);
    expect(facets.cycle['none']).toBe(2);
    expect(facets.label['none']).toBe(2);
    expect(facets.milestone['none']).toBe(2);
  });

  it('leaves the facet counts untouched when a filter narrows the result', async () => {
    const done = await newIssue('Shipped');
    await newIssue('Waiting');
    await updateIssue(workspace.admin, done.id, { stateId: stateNamed(workspace, 'Done').id });

    const summary = await getIssueSummary(workspace.admin, {
      teamId: workspace.teamId,
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            property: 'state',
            operator: 'in',
            values: [stateNamed(workspace, 'Done').id],
            negate: false,
          },
        ],
      },
    });

    expect(summary.total).toBe(1);

    const scoped = await getIssueFacets(workspace.admin, { teamId: workspace.teamId });
    expect(scoped.scopeTotal).toBe(2);
    expect(scoped.facets.state[stateNamed(workspace, 'Todo').id]).toBe(1);
  });

  it('reads every column facet in one grouping sets pass instead of one query each', () => {
    const { sql: text } = new PgDialect().sqlToQuery(columnFacetsSql(undefined));

    expect(text.match(/grouping sets/g)).toHaveLength(1);
    for (const column of [
      'state_id',
      'assignee_id',
      'creator_id',
      'priority',
      'estimate',
      'project_id',
      'cycle_id',
    ]) {
      expect(text).toContain(`grouping("issue"."${column}")`);
    }
  });
});

describe('getIssue', () => {
  it('resolves by id and by identifier', async () => {
    const issue = await newIssue('Findable');
    expect((await getIssue(workspace.admin, issue.id)).id).toBe(issue.id);
    expect((await getIssue(workspace.admin, 'NOVA-1')).id).toBe(issue.id);
    expect((await getIssue(workspace.admin, 'nova-1')).id).toBe(issue.id);
  });
});

describe('parent and due date writes', () => {
  it('stores a due date the caller sends and clears it again', async () => {
    const issue = await newIssue('Ships friday');

    const dated = await updateIssue(workspace.admin, issue.id, { dueDate: '2031-03-04' });
    expect(dated.issue.dueDate).toBe('2031-03-04');
    expect(dated.changes.map((change) => change.field)).toContain('dueDate');

    const cleared = await updateIssue(workspace.admin, issue.id, { dueDate: null });
    expect(cleared.issue.dueDate).toBeNull();
  });

  it('refuses a parent that sits in a team the caller cannot see', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const { principal } = await addMember(workspace, 'member');
    const mine = await newIssue('Out in the open');

    await expect(updateIssue(principal, mine.id, { parentId: hidden.id })).rejects.toMatchObject({
      code: 'not_found',
    });

    await expect(
      createIssue(principal, {
        teamId: workspace.teamId,
        title: 'Smuggled child',
        parentId: hidden.id,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('accepts a parent the caller shares a team with', async () => {
    const { principal } = await addMember(workspace, 'member');
    const parent = await newIssue('Epic');
    const child = await newIssue('Task');

    const updated = await updateIssue(principal, child.id, { parentId: parent.id });
    expect(updated.issue.parentId).toBe(parent.id);
  });

  it('refuses a due date that is not a calendar day', async () => {
    const issue = await newIssue('Ships never');

    for (const nonsense of [true, false, 0, 1_700_000_000_000, 'banana', {}, []]) {
      await expect(updateIssue(workspace.admin, issue.id, { dueDate: nonsense })).rejects.toThrow();
    }

    expect((await getIssue(workspace.admin, issue.id)).dueDate).toBeNull();
  });

  it('refuses a due date outside the years a date column can hold', async () => {
    const issue = await newIssue('Ships eventually');

    for (const extreme of ['+275760-09-13', '-000001-01-01', '0000-12-31', '10000-01-01']) {
      await expect(
        updateIssue(workspace.admin, issue.id, { dueDate: extreme }),
      ).rejects.toBeInstanceOf(ZodError);
      await expect(
        createIssue(workspace.admin, {
          teamId: workspace.teamId,
          title: 'Far off',
          dueDate: extreme,
        }),
      ).rejects.toBeInstanceOf(ZodError);
    }

    expect((await getIssue(workspace.admin, issue.id)).dueDate).toBeNull();
  });

  it('keeps a due date at either end of the range a date column can hold', async () => {
    const issue = await newIssue('Ships at the edge');

    expect(
      (await updateIssue(workspace.admin, issue.id, { dueDate: '0001-01-01' })).issue.dueDate,
    ).toBe('0001-01-01');
    expect(
      (await updateIssue(workspace.admin, issue.id, { dueDate: '9999-12-31' })).issue.dueDate,
    ).toBe('9999-12-31');
  });
});

describe('relations', () => {
  it('keeps the inverse relation consistent', async () => {
    const blocker = await newIssue('Blocker');
    const blocked = await newIssue('Blocked');

    const { relations, actions } = await setRelation(workspace.admin, blocker.id, {
      relatedIssueId: blocked.id,
      type: 'blocks',
    });
    expect(relations).toHaveLength(2);
    expect(actions.every((action) => action.model === 'issue_relation')).toBe(true);

    const inverse = await listRelations(workspace.admin, blocked.id);
    expect(inverse[0]?.type).toBe('blocked_by');

    await removeRelation(workspace.admin, blocker.id, {
      relatedIssueId: blocked.id,
      type: 'blocks',
    });
    expect(await listRelations(workspace.admin, blocked.id)).toHaveLength(0);
  });

  it('rejects a self relation', async () => {
    const issue = await newIssue('Lonely');
    await expect(
      setRelation(workspace.admin, issue.id, { relatedIssueId: issue.id, type: 'related' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('returns the related issue rows alongside the link', async () => {
    const blocker = await newIssue('Blocker');
    const blocked = await newIssue('Blocked');
    await setRelation(workspace.admin, blocker.id, {
      relatedIssueId: blocked.id,
      type: 'blocks',
    });

    const related = await listRelatedIssues(workspace.admin, blocker.id);
    expect(related).toHaveLength(1);
    expect(related[0]?.type).toBe('blocks');
    expect(related[0]?.issue.identifier).toBe(blocked.identifier);
    expect(related[0]?.issue.title).toBe('Blocked');
  });

  it('refuses to list the relations of an issue the caller cannot see', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const { principal } = await addMember(workspace, 'member');

    await expect(listRelations(principal, hidden.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(listRelatedIssues(principal, hidden.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('leaves out a related issue that sits in a team the caller cannot see', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const mine = await newIssue('Out in the open');
    await setRelation(workspace.admin, mine.id, { relatedIssueId: hidden.id, type: 'blocks' });
    const { principal } = await addMember(workspace, 'member');

    expect(await listRelatedIssues(workspace.admin, mine.id)).toHaveLength(1);
    expect(await listRelatedIssues(principal, mine.id)).toEqual([]);
  });

  it('refuses to unlink an issue that sits in a team the caller cannot see', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const mine = await newIssue('Out in the open');
    await setRelation(workspace.admin, mine.id, { relatedIssueId: hidden.id, type: 'blocks' });
    const { principal } = await addMember(workspace, 'member');

    await expect(
      removeRelation(principal, mine.id, { relatedIssueId: hidden.id, type: 'blocks' }),
    ).rejects.toMatchObject({ code: 'not_found' });

    expect(await listRelations(workspace.admin, hidden.id)).toHaveLength(1);
    expect(await listRelations(workspace.admin, mine.id)).toHaveLength(1);
  });

  it('refuses to link an issue that sits in a team the caller cannot see', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const { principal } = await addMember(workspace, 'member');
    const mine = await createIssue(principal, { teamId: workspace.teamId, title: 'Mine' });

    await expect(
      setRelation(principal, mine.issue.id, { relatedIssueId: hidden.id, type: 'blocks' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await listRelations(workspace.admin, hidden.id)).toHaveLength(0);
  });
});

describe('subscriptions', () => {
  it('subscribes and unsubscribes a principal', async () => {
    const issue = await newIssue('Watched');
    const { principal } = await addMember(workspace, 'member');

    const added = await subscribe(principal, issue.id);
    expect(added.actions[0]?.scopes).toContain(scopes.user(principal.userId));
    expect((await listSubscribers(workspace.admin, issue.id)).map((row) => row.userId)).toContain(
      principal.userId,
    );

    await unsubscribe(principal, issue.id);
    expect(
      (await listSubscribers(workspace.admin, issue.id)).map((row) => row.userId),
    ).not.toContain(principal.userId);
  });
});

describe('bulkUpdateIssues', () => {
  it('updates every issue and returns one action each', async () => {
    const first = await newIssue('Bulk one');
    const second = await newIssue('Bulk two');

    const result = await bulkUpdateIssues(workspace.admin, {
      issueIds: [first.id, second.id],
      patch: { priority: 1 },
    });

    expect(result.issues.every((issue) => issue.priority === 1)).toBe(true);
    expect(result.actions).toHaveLength(2);
  });

  it('writes one batched update for the whole selection instead of one per issue', async () => {
    const created: Awaited<ReturnType<typeof newIssue>>[] = [];
    for (let index = 0; index < 25; index += 1) created.push(await newIssue(`Bulk ${index}`));
    const done = stateNamed(workspace, 'Done');

    const result = await bulkUpdateIssues(workspace.admin, {
      issueIds: created.map((issue) => issue.id),
      patch: { stateId: done.id },
    });

    expect(result.issues).toHaveLength(25);
    expect(result.issues.every((issue) => issue.stateId === done.id)).toBe(true);
    expect(new Set(result.issues.map((issue) => issue.syncId)).size).toBe(1);
    expect(new Set(result.issues.map((issue) => issue.updatedAt.getTime())).size).toBe(1);

    const activity = await db
      .select()
      .from(schema.issueActivity)
      .where(eq(schema.issueActivity.field, 'stateId'));
    expect(activity).toHaveLength(25);
    expect(activity.every((row) => row.toValue !== null)).toBe(true);
  });

  it('applies nothing when one issue in the batch fails', async () => {
    const first = await newIssue('Bulk one');

    await expect(
      bulkUpdateIssues(workspace.admin, {
        issueIds: [first.id, 'missing-issue-id'],
        patch: { priority: 1 },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const [unchanged] = await db.select().from(schema.issue).where(eq(schema.issue.id, first.id));
    expect(unchanged?.priority).toBe(0);
  });
});

describe('tenancy', () => {
  it('refuses to create an issue in another workspace team', async () => {
    const vega = await createWorkspace('Vega');

    await expect(
      createIssue(workspace.admin, { teamId: vega.teamId, title: 'Injected' }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const rows = await db.select().from(schema.issue).where(eq(schema.issue.teamId, vega.teamId));
    expect(rows).toHaveLength(0);
  });

  it('refuses to move an issue into another workspace team', async () => {
    const issue = await newIssue('Stay home');
    const vega = await createWorkspace('Vega');

    await expect(
      moveIssue(workspace.admin, issue.id, { teamId: vega.teamId }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps another team page empty for a guest', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const designState = states[0];
    if (designState === undefined) throw new Error('missing design state');
    await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Design only',
      stateId: designState.id,
    });
    await newIssue('Engineering only');

    const guest = await addMember(workspace, 'guest', { teamIds: [workspace.teamId] });

    const page = await listIssues(guest.principal, { teamId: team.id });
    expect(page.issues).toHaveLength(0);

    const own = await listIssues(guest.principal, {});
    expect(own.issues.map((issue) => issue.title)).toEqual(['Engineering only']);

    const counts = await getIssueCounts(guest.principal, { teamId: team.id });
    expect(counts).toHaveLength(0);
  });

  it('hides an issue on a team the reader is not on', async () => {
    const { team, states } = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const designState = states[0];
    if (designState === undefined) throw new Error('missing design state');
    const { issue } = await createIssue(workspace.admin, {
      teamId: team.id,
      title: 'Design only',
      stateId: designState.id,
    });
    const guest = await addMember(workspace, 'guest', { teamIds: [workspace.teamId] });

    await expect(getIssue(guest.principal, issue.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(getIssue(guest.principal, issue.identifier)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(listSubscribers(guest.principal, issue.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('an issue milestone has to belong to the project the issue is on', () => {
  async function projectWithMilestone(
    name: string,
  ): Promise<{ projectId: string; milestoneId: string }> {
    const { project } = await createProject(workspace.admin, {
      name,
      teamIds: [workspace.teamId],
    });
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: `${name} alpha`,
    });
    return { projectId: project.id, milestoneId: milestone.id };
  }

  it('refuses a milestone from a sibling project on the same team', async () => {
    const here = await projectWithMilestone('Here');
    const elsewhere = await projectWithMilestone('Elsewhere');
    const issue = await newIssue('Grouped work', { projectId: here.projectId });

    await expect(
      updateIssue(workspace.admin, issue.id, { milestoneId: elsewhere.milestoneId }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const [stored] = await db
      .select({ milestoneId: schema.issue.milestoneId })
      .from(schema.issue)
      .where(eq(schema.issue.id, issue.id));
    expect(stored?.milestoneId).toBeNull();
  });

  it('refuses a milestone on an issue that is on no project at all', async () => {
    const orphan = await projectWithMilestone('Orphan');
    const issue = await newIssue('Loose work');

    await expect(
      updateIssue(workspace.admin, issue.id, { milestoneId: orphan.milestoneId }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('takes the milestone of the project the same patch moves the issue onto', async () => {
    const here = await projectWithMilestone('Landing');
    const issue = await newIssue('Moving in');

    const updated = await updateIssue(workspace.admin, issue.id, {
      projectId: here.projectId,
      milestoneId: here.milestoneId,
    });

    expect(updated.issue.projectId).toBe(here.projectId);
    expect(updated.issue.milestoneId).toBe(here.milestoneId);
  });

  it('drops the milestone when the patch moves the issue to another project', async () => {
    const here = await projectWithMilestone('Leaving');
    const there = await projectWithMilestone('Arriving');
    const issue = await newIssue('Carried work', { projectId: here.projectId });
    const marked = await updateIssue(workspace.admin, issue.id, {
      milestoneId: here.milestoneId,
    });
    expect(marked.issue.milestoneId).toBe(here.milestoneId);

    const updated = await updateIssue(workspace.admin, issue.id, {
      projectId: there.projectId,
    });

    expect(updated.issue.projectId).toBe(there.projectId);
    expect(updated.issue.milestoneId).toBeNull();
  });

  it('drops the milestone when the issue is taken off every project', async () => {
    const here = await projectWithMilestone('Detaching');
    const issue = await newIssue('Loosened work', { projectId: here.projectId });
    const marked = await updateIssue(workspace.admin, issue.id, {
      milestoneId: here.milestoneId,
    });
    expect(marked.issue.milestoneId).toBe(here.milestoneId);

    const updated = await updateIssue(workspace.admin, issue.id, { projectId: null });

    expect(updated.issue.projectId).toBeNull();
    expect(updated.issue.milestoneId).toBeNull();
  });

  it('still takes a milestone of the project the issue is already on', async () => {
    const here = await projectWithMilestone('Steady');
    const issue = await newIssue('Already here', { projectId: here.projectId });

    const updated = await updateIssue(workspace.admin, issue.id, {
      milestoneId: here.milestoneId,
    });

    expect(updated.issue.milestoneId).toBe(here.milestoneId);
  });
});

describe('allocating an issue number under concurrency', () => {
  it('gives every concurrent create a distinct number', async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, at) =>
        createIssue(workspace.admin, { teamId: workspace.teamId, title: `Racing ${at}` }),
      ),
    );

    const numbers = created.map((entry) => entry.issue.number);

    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('gives every concurrent create a distinct identifier', async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, at) =>
        createIssue(workspace.admin, { teamId: workspace.teamId, title: `Identified ${at}` }),
      ),
    );

    const identifiers = created.map((entry) => entry.issue.identifier);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('commits the counter independently of the write that follows it', async () => {
    const counter = async (): Promise<number> => {
      const [row] = await db
        .select({ value: schema.team.issueCounter })
        .from(schema.team)
        .where(eq(schema.team.id, workspace.teamId));
      return row?.value ?? 0;
    };

    const before = await counter();

    await expect(
      createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Refused',
        stateId: 'state_that_does_not_exist',
      }),
    ).rejects.toThrow();

    expect(await counter()).toBe(before + 1);
  });

  it('refuses a team the principal may not write to', async () => {
    const { team } = await createTeam(workspace.admin, { name: 'Sealed', key: 'SEAL' });
    const { principal } = await addMember(workspace, 'member');

    await expect(createIssue(principal, { teamId: team.id, title: 'Not mine' })).rejects.toThrow(
      DomainError,
    );
  });

  it('leaves a gap rather than reusing a number when the write is refused', async () => {
    const before = await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Kept' });

    await expect(
      createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Refused',
        stateId: 'state_that_does_not_exist',
      }),
    ).rejects.toThrow();

    const after = await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Next' });

    expect(after.issue.number).toBeGreaterThan(before.issue.number + 1);
  });
});
