import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { scopes } from '@orbit/shared/events';
import { createTeam } from '../org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../test-support.ts';
import {
  archiveIssue,
  bulkUpdateIssues,
  createIssue,
  deleteIssue,
  getIssue,
  getIssueCounts,
  listIssues,
  listRelations,
  listSubscribers,
  moveIssue,
  REBALANCE_THRESHOLD,
  removeRelation,
  setRelation,
  subscribe,
  unsubscribe,
  updateIssue,
} from './issue-service.ts';

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

  it('returns a sync action scoped to org, team, and issue', async () => {
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
      expect.arrayContaining([
        scopes.organization(workspace.organizationId),
        scopes.team(workspace.teamId),
        scopes.issue(issue.id),
      ]),
    );
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
    expect(listed.issues[0]?.description).toBe('');

    const full = await listIssues(workspace.admin, { select: 'full' });
    expect(full.issues[0]?.description).toBe('A body long enough to matter on the wire.');
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

describe('getIssue', () => {
  it('resolves by id and by identifier', async () => {
    const issue = await newIssue('Findable');
    expect((await getIssue(workspace.admin, issue.id)).id).toBe(issue.id);
    expect((await getIssue(workspace.admin, 'NOVA-1')).id).toBe(issue.id);
    expect((await getIssue(workspace.admin, 'nova-1')).id).toBe(issue.id);
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
