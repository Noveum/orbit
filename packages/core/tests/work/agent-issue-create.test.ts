import { afterEach, beforeEach, expect, it } from 'bun:test';
import { and, db, eq, schema, sql } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import {
  manageAgentIdentity,
  preparePersonalAgentConsent,
} from '../../src/auth/agent-identity-service.ts';
import { recordMcpGrant } from '../../src/auth/mcp-token.ts';
import { newId } from '../../src/internal.ts';
import { addMember, createWorkspace, resetDatabase } from '../../src/test-support.ts';
import {
  createAgentIssue,
  createIssue,
  updateAgentIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

const GATES = [
  'ORBIT_AGENT_IDENTITY_READ',
  'ORBIT_AGENT_CONSENT',
  'ORBIT_AGENT_ISSUE_WRITE',
  'ORBIT_ISSUE_OUTBOX_DISPATCH',
] as const;
const originalGates = new Map(GATES.map((gate) => [gate, process.env[gate]]));

beforeEach(async () => {
  for (const gate of GATES) process.env[gate] = 'true';
  await resetDatabase();
});

afterEach(() => {
  for (const gate of GATES) {
    const original = originalGates.get(gate);
    if (original === undefined) delete process.env[gate];
    else process.env[gate] = original;
  }
});

async function fixture() {
  const workspace = await createWorkspace('Writer');
  const owner = await addMember(workspace, 'member');
  const clientId = newId();
  const identityId = newId();
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Writer client',
    redirectUrls: 'https://example.com',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: owner.user.id,
    ownerNameSnapshot: owner.user.name,
    clientId,
    clientNameSnapshot: 'Writer client',
    name: 'Researcher',
  });
  const grantId = await recordMcpGrant({
    clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read orbit.write',
    agentIdentityId: identityId,
  });
  return {
    workspace,
    owner,
    identityId,
    grantId,
    binding: {
      principal: owner.principal,
      clientId,
      agentIdentityId: identityId,
      grantId,
      scopes: 'orbit.read orbit.write',
    },
  };
}

async function waitForBlockedTransactions(count: number): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ waiting: number }>(sql`
      select count(*)::integer as waiting
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
    `);
    if ((rows[0]?.waiting ?? 0) >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

async function queueBehindOwnerMembership<TFirst, TSecond>(
  owner: Awaited<ReturnType<typeof fixture>>['owner'],
  first: () => Promise<TFirst>,
  second: () => Promise<TSecond>,
): Promise<[PromiseSettledResult<TFirst>, PromiseSettledResult<TSecond>]> {
  let releaseBlocker: () => void = () => undefined;
  let signalLock: () => void = () => undefined;
  const blockerRelease = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  const membershipLocked = new Promise<void>((resolve) => {
    signalLock = resolve;
  });
  const blocker = db.transaction(async (tx) => {
    await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, owner.principal.organizationId),
          eq(schema.member.userId, owner.user.id),
        ),
      )
      .for('update');
    signalLock();
    await blockerRelease;
  });
  await membershipLocked;
  const firstCall = first();
  try {
    expect(await waitForBlockedTransactions(1)).toBe(true);
    const secondCall = second();
    expect(await waitForBlockedTransactions(2)).toBe(true);
    releaseBlocker();
    await blocker;
    return await Promise.allSettled([firstCall, secondCall]);
  } catch (error: unknown) {
    releaseBlocker();
    await blocker;
    await Promise.allSettled([firstCall]);
    throw error;
  }
}

it('requires every rollout Gate before accepting an Agent issue write', async () => {
  const { workspace, binding } = await fixture();
  for (const gate of GATES) {
    process.env[gate] = 'false';
    await expect(
      createAgentIssue(binding, { teamId: workspace.teamId, title: `Blocked by ${gate}` }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.select().from(schema.issue)).toHaveLength(0);
    process.env[gate] = 'true';
  }
});

it('records a human to agent reassignment as one actor reference', async () => {
  const { workspace, owner, identityId } = await fixture();
  const created = await createIssue(owner.principal, {
    teamId: workspace.teamId,
    title: 'Hand off',
    assigneeId: owner.user.id,
  });
  const updated = await updateIssue(owner.principal, created.issue.id, {
    assigneeAgentId: identityId,
  });
  const outbox = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.aggregateId, created.issue.id));
  expect(outbox.map((row) => row.id).sort()).toEqual(
    [...created.actions, ...updated.actions]
      .map((action) => action.eventId)
      .filter((eventId): eventId is string => eventId !== undefined)
      .sort(),
  );
  const activity = await db
    .select()
    .from(schema.issueActivity)
    .where(eq(schema.issueActivity.issueId, created.issue.id));
  const assignments = activity.filter((row) => row.field === 'assignee');
  expect(assignments).toHaveLength(1);
  expect(assignments[0]?.fromValue).toEqual({ type: 'user', id: owner.user.id });
  expect(assignments[0]?.toValue).toEqual({ type: 'agent', id: identityId });
});

it('requires a human principal for explicit owner transfer', async () => {
  const { workspace, binding, owner } = await fixture();
  const created = await createAgentIssue(
    binding,
    {
      teamId: workspace.teamId,
      title: 'Owned by person',
    },
    'owner-transfer',
  );
  await expect(
    updateAgentIssue(binding, created.issue.id, { ownerUserId: owner.user.id }),
  ).rejects.toBeInstanceOf(DomainError);
});

it('P0-IDEM-1 replays one agent issue and rejects reuse for a different request', async () => {
  const { workspace, binding, identityId, grantId } = await fixture();
  const input = { teamId: workspace.teamId, title: 'Investigate', assigneeAgentId: identityId };
  const first = await createAgentIssue(binding, input, 'request-1');
  await db
    .update(schema.issue)
    .set({ title: 'Later title' })
    .where(eq(schema.issue.id, first.issue.id));
  const second = await createAgentIssue(
    binding,
    {
      assigneeAgentId: identityId,
      title: 'Investigate',
      teamId: workspace.teamId,
      discarded: true,
    },
    'request-1',
  );
  expect(second.replayed).toBe(true);
  expect(second.issue.id).toBe(first.issue.id);
  expect(second.issue.title).toBe('Investigate');
  expect(second.issue.updatedAt).toEqual(first.issue.updatedAt);
  expect(first.issue.creatorId).toBeNull();
  expect(first.issue.creatorAgentId).toBe(identityId);
  expect(first.issue.ownerUserId).toBe(binding.principal.userId);
  expect(first.issue.assigneeAgentId).toBe(identityId);
  expect(await db.select().from(schema.issue)).toHaveLength(1);
  expect(await db.select().from(schema.issueActivity)).toHaveLength(1);
  expect(await db.select().from(schema.issueOutbox)).toHaveLength(first.actions.length);
  expect((await db.select().from(schema.issueActivity))[0]).toMatchObject({
    actorType: 'agent',
    actorId: identityId,
    principalUserId: binding.principal.userId,
    grantId,
  });
  expect((await db.select().from(schema.auditLog))[0]).toMatchObject({
    actorType: 'agent',
    actorId: identityId,
    grantId,
  });
  const notifications = await db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.entityId, first.issue.id));
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({
    userId: binding.principal.userId,
    actorType: 'agent',
    actorId: identityId,
    principalUserId: binding.principal.userId,
    grantId,
  });
  expect(first.actions[0]?.eventId).toBeString();
  expect(JSON.stringify(first.actions)).not.toContain('grantId');
  try {
    await createAgentIssue(binding, { ...input, title: 'Different' }, 'request-1');
    throw new Error('Expected idempotency conflict');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    if (error instanceof DomainError)
      expect(error.details?.['reason']).toBe('idempotency_conflict');
  }
  expect(await db.select().from(schema.issue)).toHaveLength(1);
});

it('P0-IDEM-1 revalidates the grant before a cached response', async () => {
  const { workspace, binding, grantId } = await fixture();
  const input = { teamId: workspace.teamId, title: 'Investigate' };
  await createAgentIssue(binding, input, 'request-2');
  await db
    .update(schema.mcpGrant)
    .set({ revokedAt: new Date() })
    .where(eq(schema.mcpGrant.id, grantId));
  await expect(createAgentIssue(binding, input, 'request-2')).rejects.toMatchObject({
    code: 'unauthorized',
  });
});

it('P0-IDEM-1 isolates idempotency keys by grant', async () => {
  const { workspace, owner, binding } = await fixture();
  const { identity } = await db.transaction((tx) =>
    preparePersonalAgentConsent(tx, {
      userId: owner.user.id,
      organizationId: workspace.organizationId,
      clientId: binding.clientId,
      selection: { createAgent: { name: 'Second agent', avatar: null } },
    }),
  );
  const secondGrantId = await recordMcpGrant({
    clientId: binding.clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read orbit.write',
    agentIdentityId: identity.id,
  });
  const second = await createAgentIssue(
    {
      ...binding,
      agentIdentityId: identity.id,
      grantId: secondGrantId,
    },
    { teamId: workspace.teamId, title: 'Second grant' },
    'shared-key',
  );
  const first = await createAgentIssue(
    binding,
    { teamId: workspace.teamId, title: 'First grant' },
    'shared-key',
  );
  expect(second.replayed).toBe(false);
  expect(first.replayed).toBe(false);
  expect(second.issue.id).not.toBe(first.issue.id);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(2);
});

it('P0-IDEM-1 retries the same key after the create transaction rolls back', async () => {
  const { workspace, binding } = await fixture();
  await db.execute(
    sql.raw(`
    create function reject_issue_outbox_insert() returns trigger
    language plpgsql as $$ begin raise exception 'injected outbox failure'; end $$
  `),
  );
  await db.execute(
    sql.raw(`
    create trigger reject_issue_outbox_insert_trigger
    before insert on issue_outbox for each row execute function reject_issue_outbox_insert()
  `),
  );
  try {
    await expect(
      createAgentIssue(binding, { teamId: workspace.teamId, title: 'Retry me' }, 'retry-key'),
    ).rejects.toThrow();
  } finally {
    await db.execute(
      sql.raw('drop trigger if exists reject_issue_outbox_insert_trigger on issue_outbox'),
    );
    await db.execute(sql.raw('drop function if exists reject_issue_outbox_insert()'));
  }
  expect(await db.select().from(schema.issue)).toHaveLength(0);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(0);
  const retried = await createAgentIssue(
    binding,
    { teamId: workspace.teamId, title: 'Retry me' },
    'retry-key',
  );
  expect(retried.replayed).toBe(false);
  expect(await db.select().from(schema.issue)).toHaveLength(1);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(1);
});

it('P0-IDEM-1 keeps a key through 24 hours and expires it at the exact boundary', async () => {
  const { workspace, binding } = await fixture();
  const startedAt = new Date('2026-09-01T00:00:00.000Z');
  const input = { teamId: workspace.teamId, title: 'Boundary' };
  const first = await createAgentIssue(binding, input, 'boundary-key', startedAt);
  const [record] = await db.select().from(schema.mcpIdempotency);
  const expiresAt = new Date(startedAt.getTime() + 86_400_000);
  expect(record?.expiresAt).toEqual(expiresAt);
  const beforeExpiry = await createAgentIssue(
    binding,
    input,
    'boundary-key',
    new Date(expiresAt.getTime() - 1),
  );
  expect(beforeExpiry.replayed).toBe(true);
  expect(beforeExpiry.issue.id).toBe(first.issue.id);
  const atExpiry = await createAgentIssue(binding, input, 'boundary-key', expiresAt);
  expect(atExpiry.replayed).toBe(false);
  expect(atExpiry.issue.id).not.toBe(first.issue.id);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(1);
});

it('allows a new request after its idempotency record expires', async () => {
  const { workspace, binding } = await fixture();
  const first = await createAgentIssue(
    binding,
    { teamId: workspace.teamId, title: 'First' },
    'expiring-key',
  );
  await db
    .update(schema.mcpIdempotency)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.mcpIdempotency.idempotencyKey, 'expiring-key'));
  const second = await createAgentIssue(
    binding,
    { teamId: workspace.teamId, title: 'Second' },
    'expiring-key',
  );
  expect(second.replayed).toBe(false);
  expect(second.issue.id).not.toBe(first.issue.id);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(1);
});

it('serializes two concurrent creates with the same grant and idempotency key', async () => {
  const { workspace, binding } = await fixture();
  const input = { teamId: workspace.teamId, title: 'One issue' };
  const results = await Promise.all([
    createAgentIssue(binding, input, 'concurrent-key'),
    createAgentIssue(binding, input, 'concurrent-key'),
  ]);
  expect(results[0]?.issue.id).toBe(results[1]?.issue.id);
  expect(results.filter((result) => result.replayed)).toHaveLength(1);
  expect(await db.select().from(schema.issue)).toHaveLength(1);
  expect(await db.select().from(schema.issueOutbox)).toHaveLength(results[0]?.actions.length);
});

it('P0-ISSUE-1 assigns only the current agent and records the owner with the update', async () => {
  const { workspace, binding, identityId } = await fixture();
  const original = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Available',
  });
  const assigned = await updateAgentIssue(binding, original.issue.id, {
    assigneeAgentId: identityId,
  });
  expect(assigned.issue.assigneeAgentId).toBe(identityId);
  expect(assigned.issue.ownerUserId).toBe(binding.principal.userId);
  expect(assigned.actions[0]?.eventId).toBeString();
  expect(
    (
      await db
        .select()
        .from(schema.issueActivity)
        .where(eq(schema.issueActivity.issueId, original.issue.id))
    ).at(-1),
  ).toMatchObject({ actorType: 'agent', grantId: binding.grantId });
  await expect(
    updateAgentIssue(binding, original.issue.id, { assigneeAgentId: newId() }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const [unchanged] = await db
    .select()
    .from(schema.issue)
    .where(eq(schema.issue.id, original.issue.id));
  expect(unchanged?.assigneeAgentId).toBe(identityId);
});

it('P0-RACE-1 lets a queued pause commit before an Agent create without write side effects', async () => {
  const { workspace, binding, identityId, owner, grantId } = await fixture();
  const [paused, created] = await queueBehindOwnerMembership(
    owner,
    () => manageAgentIdentity(owner.principal, identityId, { action: 'pause' }),
    () =>
      createAgentIssue(
        binding,
        { teamId: workspace.teamId, title: 'Pause first', assigneeAgentId: identityId },
        'pause-first',
      ),
  );
  expect(paused.status).toBe('fulfilled');
  expect(created).toMatchObject({ status: 'rejected', reason: { code: 'unauthorized' } });
  expect(await db.select().from(schema.issue)).toHaveLength(0);
  expect(await db.select().from(schema.issueActivity)).toHaveLength(0);
  expect(await db.select().from(schema.notification)).toHaveLength(0);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(0);
  const [grant] = await db.select().from(schema.mcpGrant).where(eq(schema.mcpGrant.id, grantId));
  expect(grant?.revokedAt).not.toBeNull();
});

it('P0-RACE-1 commits a queued Agent create before pause and then clears its assignment', async () => {
  const { workspace, binding, identityId, owner } = await fixture();
  const [created, paused] = await queueBehindOwnerMembership(
    owner,
    () =>
      createAgentIssue(
        binding,
        { teamId: workspace.teamId, title: 'Create first', assigneeAgentId: identityId },
        'create-first',
      ),
    () => manageAgentIdentity(owner.principal, identityId, { action: 'pause' }),
  );
  expect(created.status).toBe('fulfilled');
  expect(paused.status).toBe('fulfilled');
  if (created.status !== 'fulfilled') throw new Error('The queued create did not commit.');
  const [issue] = await db
    .select()
    .from(schema.issue)
    .where(eq(schema.issue.id, created.value.issue.id));
  expect(issue?.assigneeAgentId).toBeNull();
  expect(issue?.ownerUserId).toBe(owner.user.id);
  const activities = await db
    .select()
    .from(schema.issueActivity)
    .where(eq(schema.issueActivity.issueId, created.value.issue.id));
  const assignment = activities.filter((entry) => entry.field === 'assignee');
  expect(assignment).toHaveLength(1);
  expect(assignment[0]).toMatchObject({
    fromValue: { type: 'agent', id: identityId },
    toValue: null,
    cause: 'agent_paused',
  });
  const outbox = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.aggregateId, created.value.issue.id));
  expect(outbox.length).toBeGreaterThanOrEqual(created.value.actions.length + 1);
  expect(await db.select().from(schema.mcpIdempotency)).toHaveLength(1);
  expect(
    await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, created.value.issue.id)),
  ).toHaveLength(1);
});
