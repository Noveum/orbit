import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { db, eq, schema, sql } from '@orbit/db';
import { applyGithubEvent } from '@orbit/services/github';
import type { IssueActor } from '@orbit/shared/validators';
import { newId } from '../../src/internal.ts';
import { catchUp } from '../../src/realtime/backfill.ts';
import { buildSyncAction } from '../../src/realtime/publisher.ts';
import {
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { attachIssueActionActors, attachIssueActors } from '../../src/work/issue-actor-view.ts';
import {
  archiveIssue,
  bulkUpdateIssues,
  createIssue,
  createSubIssues,
  deleteIssue,
  getIssue,
  getIssueFacets,
  getIssueSummary,
  getParentIssue,
  listBoardGroups,
  listIssues,
  listRelatedIssues,
  markAsDuplicate,
  moveIssue,
  setRelation,
  unarchiveIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

let workspace: Workspace;
let installedTrigger = false;

beforeAll(async () => {
  const [existing] = await db.execute(sql`
    select 1 from pg_trigger where tgname = 'issue_human_actor_compat_trigger'
  `);
  if (existing !== undefined) return;
  const migration = await readFile(
    new URL('../../../db/drizzle/0030_actor_schema_expand.sql', import.meta.url),
    'utf8',
  );
  const statements = migration.split('--> statement-breakpoint');
  const triggerStatements = statements.filter((statement) =>
    /^CREATE (FUNCTION sync_issue_human_actors|TRIGGER issue_human_actor_compat_trigger)/.test(
      statement.trim(),
    ),
  );
  expect(triggerStatements).toHaveLength(2);
  for (const statement of triggerStatements) await db.execute(sql.raw(statement));
  installedTrigger = true;
});

afterAll(async () => {
  if (!installedTrigger) return;
  await db.execute(sql`drop trigger issue_human_actor_compat_trigger on issue`);
  await db.execute(sql`drop function sync_issue_human_actors()`);
});

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Actorviews');
});

async function agentFixture(organizationId = workspace.organizationId, deleted = false) {
  const [agent] = await db
    .insert(schema.agentIdentity)
    .values({
      id: newId(),
      organizationId,
      ownerUserId: workspace.admin.userId,
      name: 'Build helper',
      avatar: 'https://orbit.test/build-helper.png',
      deletedAt: deleted ? new Date() : null,
      ownerNameSnapshot: workspace.adminUser.name,
      clientNameSnapshot: 'External client',
    })
    .returning();
  if (agent === undefined) throw new Error('Missing agent fixture.');
  return agent;
}

async function agentIssueFixture(options: { parentId?: string; deleted?: boolean } = {}) {
  const agent = await agentFixture(workspace.organizationId, options.deleted);
  const created = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Agent work',
    assigneeId: null,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
  });
  await db
    .update(schema.issue)
    .set({
      creatorUserId: null,
      creatorAgentId: agent.id,
      assigneeUserId: null,
      assigneeAgentId: agent.id,
      ownerUserId: workspace.admin.userId,
    })
    .where(eq(schema.issue.id, created.issue.id));
  const actor: IssueActor = {
    type: 'agent',
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    deleted: agent.deletedAt !== null,
  };
  return { id: created.issue.id, actor };
}

describe('attachIssueActors', () => {
  it('keeps real user names and avatars without workspace membership and preserves null owner', async () => {
    const user = await createUser('Former participant');
    await db
      .update(schema.user)
      .set({ image: 'https://orbit.test/person.png' })
      .where(eq(schema.user.id, user.id));
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'History',
    });
    const row = {
      ...created.issue,
      creatorUserId: user.id,
      assigneeUserId: user.id,
      ownerUserId: null,
    };
    const [read] = await attachIssueActors(db, workspace.organizationId, [row, row]);
    expect(read?.creator).toEqual({
      type: 'user',
      id: user.id,
      name: user.name,
      avatar: 'https://orbit.test/person.png',
      deleted: false,
    });
    expect(read?.assignee).toEqual(read?.creator);
    expect(read?.owner).toBeNull();
    expect(read?.creatorId).toBe(workspace.admin.userId);
  });

  it('retains deleted agent identity and uses typed tombstones for missing identities', async () => {
    const fixture = await agentIssueFixture({ deleted: true });
    const row = await getIssue(workspace.admin, fixture.id);
    expect(row.creator).toEqual(fixture.actor);
    expect(row.assignee).toEqual(fixture.actor);
    const missingUserId = newId();
    const missingAgentId = newId();
    const [missing] = await attachIssueActors(db, workspace.organizationId, [
      {
        ...row,
        creatorAgentId: missingAgentId,
        assigneeAgentId: null,
        assigneeUserId: missingUserId,
        ownerUserId: null,
      },
    ]);
    expect(missing?.creator).toEqual({
      type: 'agent',
      id: missingAgentId,
      name: 'Deleted agent',
      avatar: null,
      deleted: true,
    });
    expect(missing?.assignee).toEqual({
      type: 'user',
      id: missingUserId,
      name: 'Deleted user',
      avatar: null,
      deleted: true,
    });
    expect(missing?.owner).toBeNull();
  });

  it('does not disclose an agent referenced from another organization or infer a legacy owner', async () => {
    const foreign = await createWorkspace('Foreign');
    const agent = await agentFixture(foreign.organizationId);
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Tenant boundary',
    });
    const row = {
      ...created.issue,
      creatorUserId: null,
      creatorAgentId: agent.id,
      ownerUserId: null,
    };
    const [read] = await attachIssueActors(db, workspace.organizationId, [row]);
    expect(read?.creator).toEqual({
      type: 'agent',
      id: agent.id,
      name: 'Deleted agent',
      avatar: null,
      deleted: true,
    });
    expect(read?.owner).toBeNull();
    const [legacy] = await attachIssueActors(db, workspace.organizationId, [
      {
        ...row,
        creatorAgentId: null,
        assigneeUserId: null,
      },
    ]);
    expect(legacy?.creator.type).toBe('user');
    expect(legacy?.assignee?.id).toBe(workspace.admin.userId);
    expect(legacy?.owner).toBeNull();
    await expect(attachIssueActors(db, foreign.organizationId, [row])).rejects.toThrow(
      'organization',
    );
    expect(await attachIssueActors(db, workspace.organizationId, [])).toEqual([]);
  });
});

describe('issue actor reads', () => {
  it('preserves an unknown owner through reads, unrelated writes and catchup', async () => {
    const fixture = await agentIssueFixture();
    await db.update(schema.issue).set({ ownerUserId: null }).where(eq(schema.issue.id, fixture.id));
    expect((await getIssue(workspace.admin, fixture.id)).owner).toBeNull();
    const result = await updateIssue(workspace.admin, fixture.id, {
      title: 'Owner history unknown',
    });
    expect(result.issue.owner).toBeNull();
    expect(result.actions.find((action) => action.model === 'issue')?.data['owner']).toBeNull();
    const catchup = (await catchUp(workspace.admin, 0)).actions.find(
      (action) => action.model === 'issue' && action.modelId === fixture.id,
    );
    expect(catchup?.data['owner']).toBeNull();
  });

  it('keeps get, list, board, parent, child, relation, live and catchup actors consistent', async () => {
    const parent = await agentIssueFixture();
    const child = await agentIssueFixture({ parentId: parent.id });
    await setRelation(workspace.admin, parent.id, { relatedIssueId: child.id, type: 'related' });
    const detail = await getIssue(workspace.admin, parent.id);
    const list = await listIssues(workspace.admin, { teamId: workspace.teamId });
    const board = await listBoardGroups(workspace.admin, { teamId: workspace.teamId });
    expect(list.issues.find((issue) => issue.id === parent.id)?.creator).toEqual(detail.creator);
    expect(
      board.groups.flatMap((group) => group.issues).find((issue) => issue.id === parent.id)
        ?.assignee,
    ).toEqual(parent.actor);
    expect((await getParentIssue(workspace.admin, child.id))?.creator).toEqual(parent.actor);
    expect(
      (await listIssues(workspace.admin, { parentId: parent.id })).issues[0]?.assignee,
    ).toEqual(child.actor);
    expect((await listRelatedIssues(workspace.admin, parent.id))[0]?.issue.assignee).toEqual(
      child.actor,
    );
    const mutation = await updateIssue(workspace.admin, parent.id, { title: 'Agent work updated' });
    const live = mutation.actions.find((action) => action.model === 'issue');
    const catchup = (await catchUp(workspace.admin, 0)).actions.find(
      (action) => action.model === 'issue' && action.modelId === parent.id,
    );
    expect(mutation.issue.assignee).toEqual(parent.actor);
    expect(live?.data['creator']).toEqual(detail.creator);
    expect(catchup?.data['assignee']).toEqual(live?.data['assignee']);
    expect(catchup?.data['owner']).toEqual(live?.data['owner']);
  });

  it('preserves human writes and returns actors for creation, reassignment, no-op and sub-issues', async () => {
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Human work',
    });
    expect(created.issue.creator.type).toBe('user');
    expect(created.issue.assignee?.id).toBe(workspace.admin.userId);
    expect(created.issue.owner?.id).toBe(workspace.admin.userId);
    expect(created.actions.find((action) => action.model === 'issue')?.data['creator']).toEqual(
      created.issue.creator,
    );
    const fixture = await agentIssueFixture();
    const assigned = await updateIssue(workspace.admin, fixture.id, {
      assigneeId: workspace.admin.userId,
    });
    expect(assigned.issue.assignee).toEqual(created.issue.assignee);
    expect(assigned.issue.creator).toEqual(fixture.actor);
    expect(assigned.issue.owner).toEqual(created.issue.owner);
    const noChange = await updateIssue(workspace.admin, fixture.id, {
      title: assigned.issue.title,
    });
    expect(noChange.actions).toEqual([]);
    expect(noChange.issue.creator).toEqual(fixture.actor);
    const sub = await createSubIssues(workspace.admin, {
      parentId: created.issue.id,
      issues: [{ title: 'Child one' }, { title: 'Child two' }],
    });
    expect(sub.issues.every((issue) => issue.creator.type === 'user')).toBe(true);
    expect(
      sub.actions
        .filter((action) => action.model === 'issue')
        .every((action) => action.data['creator'] !== undefined),
    ).toBe(true);
  });

  it('decorates bulk, move, archive, duplicate and orphaned child mutation payloads', async () => {
    const parent = await agentIssueFixture();
    const child = await agentIssueFixture({ parentId: parent.id });
    const bulk = await bulkUpdateIssues(workspace.admin, {
      issueIds: [parent.id, child.id],
      patch: { priority: 1 },
    });
    expect(bulk.issues.map((issue) => issue.assignee)).toEqual([parent.actor, child.actor]);
    const moved = await moveIssue(workspace.admin, parent.id, { stateId: workspace.states[1]?.id });
    expect(moved.issue.assignee).toEqual(parent.actor);
    const archived = await archiveIssue(workspace.admin, parent.id);
    expect(archived.actions.find((action) => action.model === 'issue')?.data['creator']).toEqual(
      parent.actor,
    );
    expect((await unarchiveIssue(workspace.admin, parent.id)).issue.assignee).toEqual(parent.actor);
    const survivor = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Survivor',
    });
    const duplicate = await markAsDuplicate(workspace.admin, child.id, {
      survivorIssueId: survivor.issue.id,
    });
    expect(duplicate.issue.assignee).toEqual(child.actor);
    expect(
      (await markAsDuplicate(workspace.admin, child.id, { survivorIssueId: survivor.issue.id }))
        .issue.creator,
    ).toEqual(child.actor);
    const actions = await deleteIssue(workspace.admin, parent.id);
    expect(actions.find((action) => action.modelId === child.id)?.data['assignee']).toEqual(
      child.actor,
    );
  });

  it('groups and counts agent assignments independently from unassigned issues', async () => {
    const fixture = await agentIssueFixture();
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Unassigned',
      assigneeId: null,
    });
    const key = `agent:${fixture.actor.id}`;
    const board = await listBoardGroups(workspace.admin, {
      teamId: workspace.teamId,
      groupBy: 'assignee',
    });
    expect(board.groups.find((group) => group.id === key)?.issues[0]?.assignee).toEqual(
      fixture.actor,
    );
    expect(board.groups.find((group) => group.id === 'none')?.total).toBe(1);
    const facets = await getIssueFacets(workspace.admin, { teamId: workspace.teamId });
    expect(facets.facets.assignee[key]).toBe(1);
    expect(facets.facets.creator[key]).toBe(1);
    const summary = await getIssueSummary(workspace.admin, {
      teamId: workspace.teamId,
      groupBy: 'assignee',
    });
    expect(summary.groupTotals[key]).toBe(1);
    const participants = await getIssueSummary(workspace.admin, {
      teamId: workspace.teamId,
      groupBy: 'participant',
    });
    expect(participants.groupTotals[key]).toBe(1);
    expect(participants.groupTotals['none']).toBe(1);
  });

  it('continues an agent board column with the same actor key and cursor', async () => {
    const fixture = await agentIssueFixture();
    for (const title of ['Agent work two', 'Agent work three']) {
      const created = await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title,
        assigneeId: null,
      });
      await db
        .update(schema.issue)
        .set({ assigneeAgentId: fixture.actor.id })
        .where(eq(schema.issue.id, created.issue.id));
    }
    const key = `agent:${fixture.actor.id}`;
    const board = await listBoardGroups(workspace.admin, {
      teamId: workspace.teamId,
      groupBy: 'assignee',
      perGroup: 1,
    });
    const group = board.groups.find((entry) => entry.id === key);
    expect(group?.total).toBe(3);
    if (group === undefined || group.nextCursor === null)
      throw new Error('Missing agent column cursor.');
    const next = await listIssues(workspace.admin, {
      teamId: workspace.teamId,
      assigneeId: key,
      cursor: group.nextCursor,
      limit: 2,
    });
    expect(next.issues).toHaveLength(2);
    expect(next.issues.every((issue) => issue.assignee?.id === fixture.actor.id)).toBe(true);
    expect(new Set([...group.issues, ...next.issues].map((issue) => issue.id)).size).toBe(3);
    expect(next.nextCursor).toBeNull();
  });
});

describe('Issue event Actor adapter', () => {
  it('enriches GitHub state transitions before publication with the same Actor view as GET and catchup', async () => {
    const fixture = await agentIssueFixture({ deleted: true });
    const issue = await getIssue(workspace.admin, fixture.id);
    const integrationId = newId();
    await db.insert(schema.integration).values({
      id: integrationId,
      organizationId: workspace.organizationId,
      provider: 'github',
      externalId: 'fixture-installation',
      connectedById: workspace.admin.userId,
    });
    await db.insert(schema.githubRepositorySync).values({
      id: newId(),
      organizationId: workspace.organizationId,
      integrationId,
      teamId: workspace.teamId,
      repositoryId: '99',
      repositoryName: 'acme/web',
    });
    const actions = await db.transaction(async (tx) => {
      const result = await applyGithubEvent(tx, {
        organizationId: workspace.organizationId,
        eventName: 'pull_request',
        body: {
          action: 'opened',
          pull_request: {
            id: 7007,
            number: 7,
            title: `Implement ${issue.identifier}`,
            body: `Fixes ${issue.identifier}`,
            html_url: 'https://github.com/acme/web/pull/7',
            draft: true,
            merged: false,
            state: 'open',
            head: {
              ref: `${issue.identifier.toLowerCase()}-work`,
              sha: '0123456789abcdef0123456789abcdef01234567',
            },
            base: { ref: 'main' },
            user: { login: 'octocat', id: 500 },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'octocat', id: 500 },
        },
      });
      expect(
        result.actions.find((action) => action.model === 'issue')?.data['creator'],
      ).toBeUndefined();
      return await attachIssueActionActors(tx, result.actions);
    });
    const action = actions.find((entry) => entry.model === 'issue');
    expect(action).toBeDefined();
    expect(action?.data['creator']).toEqual(fixture.actor);
    expect(action?.data['assignee']).toEqual(fixture.actor);
    expect(action?.data['owner']).toEqual(issue.owner);
    const after = await getIssue(workspace.admin, fixture.id);
    expect(after.stateId).not.toBe(issue.stateId);
    expect(action?.data['creator']).toEqual(after.creator);
    const replay = (await catchUp(workspace.admin, issue.syncId)).actions.find(
      (entry) => entry.model === 'issue' && entry.modelId === fixture.id,
    );
    expect(replay?.data['assignee']).toEqual(action?.data['assignee']);
  });

  it('batches organizations separately while keeping partial and deletion payloads intact', async () => {
    const fixture = await agentIssueFixture();
    const [row] = await db.select().from(schema.issue).where(eq(schema.issue.id, fixture.id));
    if (row === undefined) throw new Error('Missing issue fixture.');
    const foreign = await createWorkspace('Foreignevents');
    const agent = await agentFixture(foreign.organizationId);
    const created = await createIssue(foreign.admin, {
      teamId: foreign.teamId,
      title: 'Foreign event',
      assigneeId: null,
    });
    const [foreignRow] = await db
      .update(schema.issue)
      .set({ assigneeAgentId: agent.id, ownerUserId: null })
      .where(eq(schema.issue.id, created.issue.id))
      .returning();
    if (foreignRow === undefined) throw new Error('Missing foreign fixture.');
    const event = (
      data: Record<string, unknown>,
      organizationId = workspace.organizationId,
      action: 'update' | 'delete' = 'update',
    ) =>
      buildSyncAction({
        syncId: typeof data['syncId'] === 'number' ? data['syncId'] : row.syncId,
        organizationId,
        scopes: [],
        action,
        model: 'issue',
        modelId: typeof data['id'] === 'string' ? data['id'] : row.id,
        data,
        actor: { type: 'system', id: 'github', name: 'GitHub' },
      });
    const partial = event({
      id: row.id,
      title: 'Partial delta',
      organizationId: row.organizationId,
    });
    const deletion = event(row, row.organizationId, 'delete');
    const actions = await attachIssueActionActors(db, [
      event(row),
      event(foreignRow, foreign.organizationId),
      partial,
      deletion,
    ]);
    expect(actions[0]?.data['assignee']).toEqual(fixture.actor);
    expect(actions[1]?.data['assignee']).toMatchObject({
      type: 'agent',
      id: agent.id,
      name: agent.name,
      deleted: false,
    });
    expect(actions[1]?.data['owner']).toBeNull();
    expect(actions[2]).toBe(partial);
    expect(actions[3]).toBe(deletion);
    await expect(attachIssueActionActors(db, [event(row, foreign.organizationId)])).rejects.toThrow(
      'organization',
    );
  });
});
