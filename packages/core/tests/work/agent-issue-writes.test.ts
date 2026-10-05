import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, db, eq, schema, sql, type Transaction } from '@orbit/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  bindAgentMcpCredential,
  lockMcpOwner,
  revokeMcpGrant,
  verifyMcpAccessToken,
} from '../../src/auth/mcp-token.ts';
import { lockNotificationPolicyMutation } from '../../src/notifications/access-sync.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { agentIssueWriteContext } from '../../src/work/agent-issue-context.ts';
import {
  archiveIssue,
  bulkUpdateIssues,
  createIssue,
  createSubIssues,
  deleteIssue,
  getIssue,
  markAsDuplicate,
  moveIssue,
  removeRelation,
  setRelation,
  unarchiveIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

const SECRET = 'agent-issue-writes-test-secret-2026';
const original = {
  mcp: process.env['ORBIT_AGENT_MCP'],
  write: process.env['ORBIT_AGENT_ISSUE_WRITE'],
  secret: process.env['BETTER_AUTH_SECRET'],
};
let workspace: Workspace;
let owner: Awaited<ReturnType<typeof addMember>>;
const pools: ReturnType<typeof postgres>[] = [];

async function connection(scopes = 'orbit.read orbit.write', principal = owner.principal) {
  const clientId = randomUUID();
  const identityId = randomUUID();
  const grantId = randomUUID();
  const tokenId = randomUUID();
  const accessToken = randomUUID();
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
      ),
    );
  if (membership === undefined) throw new Error('Missing membership.');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Writer client',
    redirectUrls: 'https://example.test/callback',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: principal.organizationId,
    ownerUserId: principal.userId,
    clientId,
    name: 'Issue writer',
    ownerNameSnapshot: 'Human owner',
    clientNameSnapshot: 'Writer client',
  });
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId,
    userId: principal.userId,
    organizationId: principal.organizationId,
    scopes,
    identityKind: 'agent',
    agentIdentityId: identityId,
    ownerMemberId: membership.id,
  });
  await db.insert(schema.oauthAccessToken).values({
    id: tokenId,
    accessToken,
    refreshToken: randomUUID(),
    clientId,
    userId: principal.userId,
    scopes,
    mcpGrantId: grantId,
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 120_000),
  });
  const credential = bindAgentMcpCredential(accessToken, grantId, SECRET);
  const context = agentIssueWriteContext(await verifyMcpAccessToken(credential));
  return { context, credential, principal };
}

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
  process.env['BETTER_AUTH_SECRET'] = SECRET;
  await resetDatabase();
  workspace = await createWorkspace('Agentwrites');
  owner = await addMember(workspace, 'member', { name: 'Agent owner' });
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  for (const [key, value] of [
    ['ORBIT_AGENT_MCP', original.mcp],
    ['ORBIT_AGENT_ISSUE_WRITE', original.write],
    ['BETTER_AUTH_SECRET', original.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function parallelDatabase() {
  const connectionUrl = process.env['DATABASE_URL'];
  if (connectionUrl === undefined) throw new Error('Missing test database.');
  const pool = postgres(connectionUrl, { max: 1 });
  pools.push(pool);
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

async function waitForBlockedTransaction(tx: Transaction): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [lock] = await tx.execute<{ waiting: boolean }>(sql`
      select exists(select 1 from pg_locks
      where not granted and pg_backend_pid() = any(pg_blocking_pids(pid))) as waiting
    `);
    if (lock?.waiting === true) return true;
    await Bun.sleep(10);
  }
  return false;
}

async function humanIssue(title = 'Human work', principal = workspace.admin) {
  return (await createIssue(principal, { teamId: workspace.teamId, title, assigneeId: null }))
    .issue;
}

async function cycle(target = workspace) {
  const [created] = await db
    .insert(schema.cycle)
    .values({
      id: randomUUID(),
      organizationId: target.organizationId,
      teamId: target.teamId,
      number: 100,
      name: 'Write test cycle',
      startsAt: new Date('2026-10-01'),
      endsAt: new Date('2026-10-15'),
    })
    .returning();
  if (created === undefined) throw new Error('Missing cycle.');
  return created;
}

describe('Agent Issue write boundary', () => {
  it('keeps Human defaults and Agent reads while the independent write gate is off', async () => {
    const agent = await connection();
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'false';
    const created = await createIssue(owner.principal, {
      teamId: workspace.teamId,
      title: 'Human default',
    });
    expect(created.issue.assigneeId).toBe(owner.user.id);
    expect((await getIssue(owner.principal, created.issue.id)).creator.type).toBe('user');
    await expect(
      createIssue(owner.principal, { teamId: workspace.teamId, title: 'Denied' }, agent.context),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      (await db.select().from(schema.issue)).filter((row) => row.title === 'Denied'),
    ).toHaveLength(0);
  });

  it('rejects read-only grants even when the caller forges a write scope', async () => {
    const agent = await connection('orbit.read');
    await expect(
      createIssue(owner.principal, { teamId: workspace.teamId, title: 'Read only' }, agent.context),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      createIssue(
        owner.principal,
        { teamId: workspace.teamId, title: 'Forged scope' },
        {
          ...agent.context,
          scopes: 'orbit.read orbit.write',
        },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await db.select().from(schema.issue)).toHaveLength(0);
  });

  it.each([
    'identityId',
    'grantId',
    'ownerMemberId',
    'clientId',
    'tokenId',
    'organizationId',
  ] as const)('rejects a forged %s instead of creating a Human-attributed row', async (field) => {
    const agent = await connection();
    await expect(
      createIssue(
        owner.principal,
        { teamId: workspace.teamId, title: 'Forgery' },
        {
          ...agent.context,
          [field]: randomUUID(),
        },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await db.select().from(schema.issue)).toHaveLength(0);
  });

  it.each(['grant', 'token', 'identity', 'client', 'role', 'team', 'rejoin'] as const)(
    'rechecks current %s state after authentication',
    async (change) => {
      const agent = await connection();
      const row = await humanIssue();
      const activities = await db
        .select()
        .from(schema.issueActivity)
        .where(eq(schema.issueActivity.issueId, row.id));
      if (change === 'grant') await revokeMcpGrant(agent.context.grantId, owner.user.id);
      if (change === 'token')
        await db
          .delete(schema.oauthAccessToken)
          .where(eq(schema.oauthAccessToken.id, agent.context.tokenId));
      if (change === 'identity')
        await db
          .update(schema.agentIdentity)
          .set({ deletedAt: new Date() })
          .where(eq(schema.agentIdentity.id, agent.context.identityId));
      if (change === 'client')
        await db
          .update(schema.oauthApplication)
          .set({ disabled: true })
          .where(eq(schema.oauthApplication.clientId, agent.context.clientId));
      if (change === 'role')
        await db
          .update(schema.member)
          .set({ role: 'guest' })
          .where(eq(schema.member.id, agent.context.ownerMemberId));
      if (change === 'team')
        await db
          .delete(schema.teamMember)
          .where(
            and(
              eq(schema.teamMember.userId, owner.user.id),
              eq(schema.teamMember.teamId, workspace.teamId),
            ),
          );
      if (change === 'rejoin') {
        await db.delete(schema.member).where(eq(schema.member.id, agent.context.ownerMemberId));
        await db.insert(schema.member).values({
          id: randomUUID(),
          userId: owner.user.id,
          organizationId: workspace.organizationId,
          role: 'member',
        });
      }
      await expect(
        updateIssue(owner.principal, row.id, { title: 'Must roll back' }, db, agent.context),
      ).rejects.toThrow();
      expect((await getIssue(workspace.admin, row.id)).title).toBe('Human work');
      expect(
        await db
          .select()
          .from(schema.issueActivity)
          .where(eq(schema.issueActivity.issueId, row.id)),
      ).toEqual(activities);
    },
  );

  it('rejects workspace mismatches and unreadable destination resources', async () => {
    const agent = await connection();
    const foreign = await createWorkspace('Foreignwrites');
    const row = await humanIssue();
    await expect(
      createIssue(owner.principal, { teamId: foreign.teamId, title: 'Foreign' }, agent.context),
    ).rejects.toThrow();
    await expect(
      updateIssue(foreign.admin, row.id, { title: 'Wrong workspace' }, db, agent.context),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      moveIssue(owner.principal, row.id, { teamId: foreign.teamId }, agent.context),
    ).rejects.toThrow();
    expect((await getIssue(workspace.admin, row.id)).teamId).toBe(workspace.teamId);
  });

  it('rejects a write waiting behind a concurrent Grant revocation', async () => {
    const agent = await connection();
    const row = await humanIssue();
    const parallel = parallelDatabase();
    const raced = await db.transaction(async (tx) => {
      await lockMcpOwner(tx, owner.user.id);
      const pending = Promise.allSettled([
        updateIssue(owner.principal, row.id, { title: 'After revoke' }, parallel, agent.context),
      ]);
      const waiting = await waitForBlockedTransaction(tx);
      await tx
        .update(schema.mcpGrant)
        .set({ revokedAt: new Date() })
        .where(eq(schema.mcpGrant.id, agent.context.grantId));
      return { pending, waiting };
    });
    const [result] = await raced.pending;
    expect(raced.waiting).toBe(true);
    expect(result).toMatchObject({ status: 'rejected', reason: { code: 'unauthorized' } });
    expect((await getIssue(workspace.admin, row.id)).title).toBe('Human work');
  });

  it.each(['archive', 'relation'] as const)(
    'rechecks the current Team after %s waits behind a concurrent Issue move',
    async (operation) => {
      const agent = await connection();
      const row = await humanIssue();
      const related = await humanIssue('Related issue');
      const destination = await createTeam(workspace.admin, { name: 'Restricted', key: 'RST' });
      const state = destination.states[0];
      if (state === undefined) throw new Error('Missing destination state.');
      const parallel = parallelDatabase();
      const activities = await db.select().from(schema.issueActivity);
      const raced = await parallel.transaction(async (tx) => {
        await tx.select().from(schema.issue).where(eq(schema.issue.id, row.id)).for('update');
        const pending = Promise.allSettled([
          operation === 'archive'
            ? archiveIssue(owner.principal, row.id, agent.context)
            : setRelation(
                owner.principal,
                row.id,
                { relatedIssueId: related.id, type: 'related' },
                agent.context,
              ),
        ]);
        const waiting = await waitForBlockedTransaction(tx);
        await tx
          .update(schema.issue)
          .set({ teamId: destination.team.id, stateId: state.id })
          .where(eq(schema.issue.id, row.id));
        return { pending, waiting };
      });
      const [result] = await raced.pending;
      expect(raced.waiting).toBe(true);
      expect(result).toMatchObject({ status: 'rejected', reason: { code: 'not_found' } });
      expect(await getIssue(workspace.admin, row.id)).toMatchObject({
        teamId: destination.team.id,
        archivedAt: null,
      });
      expect(await db.select().from(schema.issueRelation)).toHaveLength(0);
      expect(await db.select().from(schema.issueActivity)).toEqual(activities);
    },
  );

  it('waits for notification policy before acquiring Owner locks and rechecks lifecycle revocation', async () => {
    const agent = await connection();
    const row = await humanIssue();
    const parallel = parallelDatabase();
    const activities = await db.select().from(schema.issueActivity);
    const raced = await db.transaction(async (tx) => {
      await lockNotificationPolicyMutation(tx, workspace.organizationId);
      const pending = Promise.allSettled([
        updateIssue(owner.principal, row.id, { title: 'After removal' }, parallel, agent.context),
      ]);
      const waiting = await waitForBlockedTransaction(tx);
      const [lock] = await tx.execute<{ available: boolean }>(sql`
        select pg_try_advisory_xact_lock(hashtextextended(${`mcp-owner:${owner.user.id}`}, 0)) as available
      `);
      const ownerAvailable = lock?.available === true;
      if (ownerAvailable)
        await tx
          .update(schema.mcpGrant)
          .set({ revokedAt: new Date() })
          .where(eq(schema.mcpGrant.id, agent.context.grantId));
      return { pending, waiting, ownerAvailable };
    });
    const [result] = await raced.pending;
    expect(raced.waiting).toBe(true);
    expect(raced.ownerAvailable).toBe(true);
    expect(result).toMatchObject({ status: 'rejected', reason: { code: 'unauthorized' } });
    expect((await getIssue(workspace.admin, row.id)).title).toBe('Human work');
    expect(await db.select().from(schema.issueActivity)).toEqual(activities);
  });
});

describe('Issue Actor and Human responsibility', () => {
  it('records canonical Agent assignment activity when moving an Issue with a NULL legacy assignee', async () => {
    const agent = await connection();
    const row = await humanIssue();
    const moved = await moveIssue(
      owner.principal,
      row.id,
      { assigneeAgentId: agent.context.identityId },
      agent.context,
    );
    expect(moved.issue).toMatchObject({
      assigneeId: null,
      assigneeAgentId: agent.context.identityId,
    });
    const [activity] = await db
      .select()
      .from(schema.issueActivity)
      .where(
        and(eq(schema.issueActivity.issueId, row.id), eq(schema.issueActivity.field, 'assigneeId')),
      );
    expect(activity).toMatchObject({
      actorType: 'agent',
      actorId: agent.context.identityId,
      fromValue: null,
      toValue: { type: 'agent', id: agent.context.identityId },
    });
  });

  it('records the actual Agent creator and initializes Owner only on first assignment', async () => {
    const agent = await connection();
    const created = await createIssue(
      owner.principal,
      { teamId: workspace.teamId, title: 'Agent created' },
      agent.context,
    );
    expect(created.issue).toMatchObject({
      creatorId: null,
      creatorUserId: null,
      creatorAgentId: agent.context.identityId,
      assigneeId: null,
      ownerUserId: null,
    });
    expect(created.issue.creator).toMatchObject({ type: 'agent', id: agent.context.identityId });
    const assigned = await updateIssue(
      owner.principal,
      created.issue.id,
      { assigneeAgentId: agent.context.identityId },
      db,
      agent.context,
    );
    expect(assigned.issue).toMatchObject({
      assigneeId: null,
      assigneeUserId: null,
      assigneeAgentId: agent.context.identityId,
      ownerUserId: owner.user.id,
    });
    const human = await updateIssue(workspace.admin, created.issue.id, {
      assigneeId: workspace.admin.userId,
    });
    expect(human.issue.ownerUserId).toBe(owner.user.id);
    await updateIssue(
      owner.principal,
      created.issue.id,
      { assigneeAgentId: agent.context.identityId },
      db,
      agent.context,
    );
    const cleared = await updateIssue(workspace.admin, created.issue.id, { assigneeId: null });
    expect(cleared.issue).toMatchObject({
      assigneeId: null,
      assigneeUserId: null,
      assigneeAgentId: null,
      ownerUserId: owner.user.id,
    });
    expect(cleared.issue.creator).toEqual(created.issue.creator);
    expect(
      assigned.actions.some(
        (action) => action.actor.type === 'agent' && action.actor.id === agent.context.identityId,
      ),
    ).toBe(true);
    expect(JSON.stringify(assigned.actions)).not.toContain(agent.context.grantId);
    await expect(
      updateIssue(
        owner.principal,
        created.issue.id,
        { ownerUserId: workspace.admin.userId },
        db,
        agent.context,
      ),
    ).rejects.toThrow();
  });

  it('initializes empty Owner on Human assignment and restricts establishing Personal Agent assignments', async () => {
    const agent = await connection();
    const row = await humanIssue();
    await expect(
      updateIssue(workspace.admin, row.id, { assigneeAgentId: agent.context.identityId }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const assigned = await updateIssue(owner.principal, row.id, {
      assigneeAgentId: agent.context.identityId,
    });
    expect(assigned.issue.ownerUserId).toBe(owner.user.id);
    const replaced = await updateIssue(workspace.admin, row.id, {
      assigneeId: workspace.admin.userId,
    });
    expect(replaced.issue.assigneeAgentId).toBeNull();
    expect(replaced.issue.ownerUserId).toBe(owner.user.id);
    const empty = await humanIssue('Empty owner');
    const human = await updateIssue(workspace.admin, empty.id, { assigneeId: owner.user.id });
    expect(human.issue.ownerUserId).toBe(owner.user.id);
  });

  it('forbids one Agent assigning another Agent owned by the same Human', async () => {
    const actor = await connection();
    const target = await connection();
    const row = await humanIssue();
    await expect(
      updateIssue(
        owner.principal,
        row.id,
        { assigneeAgentId: target.context.identityId },
        db,
        actor.context,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const assigned = await updateIssue(owner.principal, row.id, {
      assigneeAgentId: target.context.identityId,
    });
    expect(assigned.issue.assigneeAgentId).toBe(target.context.identityId);
    const replaced = await updateIssue(
      owner.principal,
      row.id,
      { assigneeAgentId: actor.context.identityId },
      db,
      actor.context,
    );
    expect(replaced.issue.assigneeAgentId).toBe(actor.context.identityId);
    expect(replaced.issue.ownerUserId).toBe(owner.user.id);
  });

  it('notifies Agent Owner when Issue Owner differs and preserves Human self-notification rules', async () => {
    const agent = await connection();
    const row = (
      await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Different owners' })
    ).issue;
    const assigned = await updateIssue(
      owner.principal,
      row.id,
      { assigneeAgentId: agent.context.identityId },
      db,
      agent.context,
    );
    expect(assigned.issue.ownerUserId).toBe(workspace.admin.userId);
    let notifications = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.entityId, row.id));
    expect(
      notifications.filter((entry) => entry.type === 'issue_assigned').map((entry) => entry.userId),
    ).toEqual([owner.user.id]);
    expect(notifications.find((entry) => entry.type === 'issue_assigned')).toMatchObject({
      actorType: 'agent',
      actorId: agent.context.identityId,
    });
    await updateIssue(
      owner.principal,
      row.id,
      { assigneeAgentId: agent.context.identityId },
      db,
      agent.context,
    );
    expect(
      await db.select().from(schema.notification).where(eq(schema.notification.entityId, row.id)),
    ).toHaveLength(notifications.length);
    await updateIssue(workspace.admin, row.id, { assigneeId: null });
    await updateIssue(owner.principal, row.id, { assigneeAgentId: agent.context.identityId });
    notifications = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.entityId, row.id));
    expect(notifications.filter((entry) => entry.type === 'issue_assigned')).toHaveLength(1);
  });

  it('rejects a cross-Team move whose final Agent Owner cannot read the destination', async () => {
    const agent = await connection();
    const row = await humanIssue();
    await updateIssue(owner.principal, row.id, { assigneeAgentId: agent.context.identityId });
    const teamId = randomUUID();
    await db.insert(schema.team).values({
      id: teamId,
      organizationId: workspace.organizationId,
      name: 'Restricted',
      key: 'RST',
    });
    const result = moveIssue(workspace.admin, row.id, { teamId });
    await expect(result).rejects.toThrow();
    expect((await getIssue(workspace.admin, row.id)).teamId).toBe(workspace.teamId);
  });

  it('rejects a Human assignment when the proposed assignee cannot read the Issue', async () => {
    const inaccessible = await addMember(workspace, 'member', { teamIds: [] });
    const agent = await connection();
    const row = await humanIssue();
    await expect(
      updateIssue(owner.principal, row.id, { assigneeId: inaccessible.user.id }, db, agent.context),
    ).rejects.toThrow();
    expect((await getIssue(workspace.admin, row.id)).assigneeId).toBeNull();
  });
});

describe('Agent Issue mutation coverage and atomicity', () => {
  it.each(['child', 'relation'] as const)(
    'rejects deleting an Issue when an affected %s belongs to an unreadable Team',
    async (resource) => {
      const agent = await connection();
      const parent = await humanIssue();
      const destination = await createTeam(workspace.admin, { name: 'Restricted', key: 'RST' });
      const child = (
        await createIssue(workspace.admin, {
          teamId: destination.team.id,
          title: 'Restricted issue',
          ...(resource === 'child' ? { parentId: parent.id } : {}),
          assigneeId: null,
        })
      ).issue;
      if (resource === 'relation')
        await setRelation(workspace.admin, parent.id, {
          relatedIssueId: child.id,
          type: 'related',
        });
      const beforeParent = await getIssue(workspace.admin, parent.id);
      const beforeChild = await getIssue(workspace.admin, child.id);
      const activities = await db.select().from(schema.issueActivity);
      const relations = await db.select().from(schema.issueRelation);
      await expect(deleteIssue(owner.principal, parent.id, db, agent.context)).rejects.toThrow();
      expect(await getIssue(workspace.admin, parent.id)).toEqual(beforeParent);
      expect(await getIssue(workspace.admin, child.id)).toEqual(beforeChild);
      expect(await db.select().from(schema.issueActivity)).toEqual(activities);
      expect(await db.select().from(schema.issueRelation)).toEqual(relations);
    },
  );

  it('rejects replacing a duplicate relation when its old survivor belongs to an unreadable Team', async () => {
    const agent = await connection();
    const source = await humanIssue('Duplicate source');
    const target = await humanIssue('New survivor');
    const destination = await createTeam(workspace.admin, { name: 'Restricted', key: 'RST' });
    const old = (
      await createIssue(workspace.admin, {
        teamId: destination.team.id,
        title: 'Old survivor',
        assigneeId: null,
      })
    ).issue;
    await markAsDuplicate(workspace.admin, source.id, { survivorIssueId: old.id });
    const beforeSource = await getIssue(workspace.admin, source.id);
    const relations = await db.select().from(schema.issueRelation);
    const subscriptions = await db.select().from(schema.issueSubscription);
    const activities = await db.select().from(schema.issueActivity);
    await expect(
      markAsDuplicate(owner.principal, source.id, { survivorIssueId: target.id }, agent.context),
    ).rejects.toThrow();
    expect(await getIssue(workspace.admin, source.id)).toEqual(beforeSource);
    expect(await db.select().from(schema.issueRelation)).toEqual(relations);
    expect(await db.select().from(schema.issueSubscription)).toEqual(subscriptions);
    expect(await db.select().from(schema.issueActivity)).toEqual(activities);
  });

  it('attributes sub-issues, bulk, cycle, relations, duplicate, archive and delete operations to the Agent', async () => {
    const agent = await connection();
    const parent = await humanIssue();
    const children = await createSubIssues(
      owner.principal,
      { parentId: parent.id, issues: [{ title: 'One' }, { title: 'Two' }] },
      agent.context,
    );
    expect(children.issues.every((row) => row.creatorAgentId === agent.context.identityId)).toBe(
      true,
    );
    const child = children.issues[0];
    if (child === undefined) throw new Error('Missing child.');
    const grandchild = (
      await createIssue(
        owner.principal,
        { teamId: workspace.teamId, title: 'Accessible descendant', parentId: child.id },
        agent.context,
      )
    ).issue;
    const bulk = await bulkUpdateIssues(
      owner.principal,
      { issueIds: children.issues.map((row) => row.id), patch: { priority: 1 } },
      agent.context,
    );
    expect(bulk.issues.every((row) => row.priority === 1)).toBe(true);
    const sprint = await cycle();
    const moved = await moveIssue(owner.principal, child.id, { cycleId: sprint.id }, agent.context);
    expect(moved.issue.cycleId).toBe(sprint.id);
    const relation = await setRelation(
      owner.principal,
      child.id,
      { relatedIssueId: parent.id, type: 'related' },
      agent.context,
    );
    expect(relation.actions.some((action) => action.actor.type === 'agent')).toBe(true);
    await removeRelation(
      owner.principal,
      child.id,
      { relatedIssueId: parent.id, type: 'related' },
      agent.context,
    );
    const duplicate = await markAsDuplicate(
      owner.principal,
      child.id,
      { survivorIssueId: parent.id },
      agent.context,
    );
    expect(
      duplicate.actions
        .filter((action) => action.model !== 'notification_conversation')
        .every((action) => action.actor.type === 'agent'),
    ).toBe(true);
    expect(
      (await archiveIssue(owner.principal, child.id, agent.context)).actions.every(
        (action) => action.actor.type === 'agent',
      ),
    ).toBe(true);
    await unarchiveIssue(owner.principal, child.id, agent.context);
    const deletion = await deleteIssue(owner.principal, child.id, db, agent.context);
    expect((await getIssue(workspace.admin, grandchild.id)).parentId).toBeNull();
    expect(
      deletion.some((action) => action.model === 'issue' && action.actor.type === 'agent'),
    ).toBe(true);
  });

  it('rolls back every bulk resource and sub-issue when any member is unauthorized or invalid', async () => {
    const agent = await connection();
    const row = await humanIssue();
    const foreign = await createWorkspace('Bulkforeign');
    const other = (await createIssue(foreign.admin, { teamId: foreign.teamId, title: 'Foreign' }))
      .issue;
    await expect(
      bulkUpdateIssues(
        owner.principal,
        { issueIds: [row.id, other.id], patch: { priority: 1 } },
        agent.context,
      ),
    ).rejects.toThrow();
    expect((await getIssue(workspace.admin, row.id)).priority).toBe(0);
    await expect(
      createSubIssues(
        owner.principal,
        {
          parentId: row.id,
          issues: [{ title: 'Valid' }, { title: 'Invalid', stateId: other.stateId }],
        },
        agent.context,
      ),
    ).rejects.toThrow();
    expect(
      await db.select().from(schema.issue).where(eq(schema.issue.parentId, row.id)),
    ).toHaveLength(0);
    await expect(
      markAsDuplicate(owner.principal, row.id, { survivorIssueId: other.id }, agent.context),
    ).rejects.toThrow();
    await expect(
      setRelation(
        owner.principal,
        row.id,
        { relatedIssueId: other.id, type: 'related' },
        agent.context,
      ),
    ).rejects.toThrow();
    const foreignCycle = await cycle(foreign);
    await expect(
      moveIssue(owner.principal, row.id, { cycleId: foreignCycle.id }, agent.context),
    ).rejects.toThrow();
    expect((await getIssue(workspace.admin, row.id)).cycleId).toBeNull();
    expect(await db.select().from(schema.issueRelation)).toHaveLength(0);
  });
});
