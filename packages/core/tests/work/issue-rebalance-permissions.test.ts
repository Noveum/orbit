import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, db, eq, schema, sql, type Transaction } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { bindAgentMcpCredential, verifyMcpAccessToken } from '../../src/auth/mcp-token.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { agentIssueWriteContext } from '../../src/work/agent-issue-context.ts';
import { createIssue, moveIssue } from '../../src/work/issue-service.ts';

const secret = 'issue-rebalance-permissions-secret';
const originalEnvironment = {
  mcp: process.env['ORBIT_AGENT_MCP'],
  write: process.env['ORBIT_AGENT_ISSUE_WRITE'],
  secret: process.env['BETTER_AUTH_SECRET'],
};
let workspace: Workspace;

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
  process.env['BETTER_AUTH_SECRET'] = secret;
  await resetDatabase();
  workspace = await createWorkspace('Rebalancepermissions');
});

afterEach(() => {
  for (const [key, value] of [
    ['ORBIT_AGENT_MCP', originalEnvironment.mcp],
    ['ORBIT_AGENT_ISSUE_WRITE', originalEnvironment.write],
    ['BETTER_AUTH_SECRET', originalEnvironment.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function connection(principal: Principal) {
  const clientId = randomUUID();
  const identityId = randomUUID();
  const grantId = randomUUID();
  const accessToken = randomUUID();
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspace.organizationId),
        eq(schema.member.userId, principal.userId),
      ),
    );
  if (membership === undefined) throw new Error('Missing membership.');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Rebalance client',
    redirectUrls: 'https://example.test/callback',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: principal.userId,
    clientId,
    name: 'Rebalance Agent',
    ownerNameSnapshot: 'Human owner',
    clientNameSnapshot: 'Rebalance client',
  });
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId,
    userId: principal.userId,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read orbit.write',
    identityKind: 'agent',
    agentIdentityId: identityId,
    ownerMemberId: membership.id,
  });
  await db.insert(schema.oauthAccessToken).values({
    id: randomUUID(),
    accessToken,
    refreshToken: randomUUID(),
    clientId,
    userId: principal.userId,
    scopes: 'orbit.read orbit.write',
    mcpGrantId: grantId,
    accessTokenExpiresAt: new Date(Date.now() + 120_000),
    refreshTokenExpiresAt: new Date(Date.now() + 240_000),
  });
  return agentIssueWriteContext(
    await verifyMcpAccessToken(bindAgentMcpCredential(accessToken, grantId, secret)),
  );
}

async function column() {
  const issues: Awaited<ReturnType<typeof createIssue>>['issue'][] = [];
  for (const [title, sortOrder] of [
    ['Before', 1],
    ['After', 1.00001],
    ['Moving', 100],
  ] as const) {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title,
      assigneeId: null,
    });
    await db.update(schema.issue).set({ sortOrder }).where(eq(schema.issue.id, issue.id));
    issues.push(issue);
  }
  const [before, after, moving] = issues;
  if (before === undefined || after === undefined || moving === undefined)
    throw new Error('Missing column.');
  return { before, after, moving };
}

async function blockedTransaction(): Promise<boolean> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const [lock] = await db.execute<{ waiting: boolean }>(
      sql`select exists(select 1 from pg_locks l join pg_stat_activity a using(pid) where a.datname = current_database() and not l.granted and cardinality(pg_blocking_pids(l.pid)) > 0) as waiting`,
    );
    if (lock?.waiting === true) return true;
    await Bun.sleep(10);
  }
  return false;
}

describe('column rebalance current resource authorization', () => {
  it('completes concurrent rebalances from different Human owners without a row lock cycle', async () => {
    const firstOwner = await addMember(workspace, 'member');
    const secondOwner = await addMember(workspace, 'member');
    const firstContext = await connection(firstOwner.principal);
    const secondContext = await connection(secondOwner.principal);
    const { before, after, moving } = await column();
    const { issue: secondMoving } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Second moving Issue',
      assigneeId: null,
    });
    const connectionUrl = process.env['DATABASE_URL'];
    if (connectionUrl === undefined) throw new Error('Missing database.');
    const pool = postgres(connectionUrl, { max: 4 });
    const database = drizzle({ client: pool, schema, casing: 'snake_case' });
    const originalTransaction = db.transaction.bind(db);
    let releaseBlocker: (() => void) | undefined;
    let announceBlocked: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      announceBlocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocker = database.transaction(async (tx) => {
      await tx.select().from(schema.issue).where(eq(schema.issue.id, before.id)).for('update');
      announceBlocked?.();
      await release;
    });
    await blocked;
    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: (work: (tx: Transaction) => Promise<unknown>) => database.transaction(work),
    });
    const moves = Promise.allSettled([
      moveIssue(
        firstOwner.principal,
        moving.id,
        { beforeId: before.id, afterId: after.id },
        firstContext,
      ),
      moveIssue(
        secondOwner.principal,
        secondMoving.id,
        { beforeId: before.id, afterId: after.id },
        secondContext,
      ),
    ]);
    try {
      let bothWaiting = false;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const [waiting] = await db.execute<{ count: number }>(
          sql`select count(distinct l.pid)::integer as count from pg_locks l join pg_stat_activity a using(pid) where a.datname = current_database() and not l.granted and cardinality(pg_blocking_pids(l.pid)) > 0`,
        );
        if ((waiting?.count ?? 0) >= 2) {
          bothWaiting = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(bothWaiting).toBe(true);
      releaseBlocker?.();
      await blocker;
      const results = await moves;
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      for (const result of results) {
        if (result.status === 'fulfilled') {
          expect(result.value.actions.every((action) => action.actor?.type === 'agent')).toBe(true);
        }
      }
    } finally {
      releaseBlocker?.();
      await blocker;
      await moves;
      Object.defineProperty(db, 'transaction', { configurable: true, value: originalTransaction });
      await pool.end();
    }
  });

  it('rejects a concurrent public Team move before changing an inaccessible Issue', async () => {
    const owner = await addMember(workspace, 'member');
    const context = await connection(owner.principal);
    const destination = await createTeam(workspace.admin, {
      name: 'Restricted destination',
      key: 'DEST',
    });
    const destinationState = destination.states[0];
    if (destinationState === undefined) throw new Error('Missing state.');
    const { before, after, moving } = await column();
    const { issue: candidate } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Concurrent column candidate',
      assigneeId: null,
    });
    await db.update(schema.issue).set({ sortOrder: 0.5 }).where(eq(schema.issue.id, candidate.id));
    let releaseHuman: (() => void) | undefined;
    let announceHuman: (() => void) | undefined;
    const humanReady = new Promise<void>((resolve) => {
      announceHuman = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseHuman = resolve;
    });
    const originalTransaction = db.transaction.bind(db);
    const connectionUrl = process.env['DATABASE_URL'];
    if (connectionUrl === undefined) throw new Error('Missing database.');
    const pool = postgres(connectionUrl, { max: 2 });
    const database = drizzle({ client: pool, schema, casing: 'snake_case' });
    let intercept = true;
    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: (work: (tx: Transaction) => Promise<unknown>) => {
        if (!intercept) return database.transaction(work);
        intercept = false;
        return database.transaction(async (tx) => {
          const result = await work(tx);
          announceHuman?.();
          await release;
          return result;
        });
      },
    });
    const human = moveIssue(workspace.admin, candidate.id, {
      teamId: destination.team.id,
      stateId: destinationState.id,
    });
    let agent: Promise<PromiseSettledResult<Awaited<ReturnType<typeof moveIssue>>>[]> | undefined;
    try {
      await humanReady;
      agent = Promise.allSettled([
        moveIssue(owner.principal, moving.id, { beforeId: before.id, afterId: after.id }, context),
      ]);
      expect(await blockedTransaction()).toBe(true);
      releaseHuman?.();
      const moved = await human;
      const [result] = await agent;
      expect(result).toMatchObject({ status: 'rejected', reason: { code: 'not_found' } });
      const [destinationIssue] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, candidate.id));
      expect(destinationIssue).toMatchObject({
        teamId: destination.team.id,
        sortOrder: moved.issue.sortOrder,
        syncId: moved.issue.syncId,
      });
      const [unchanged] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, moving.id));
      expect(unchanged?.sortOrder).toBe(100);
    } finally {
      releaseHuman?.();
      await human.catch(() => undefined);
      await agent;
      Object.defineProperty(db, 'transaction', { configurable: true, value: originalTransaction });
      await pool.end();
    }
  });

  it('rebalances only the authorized column and emits the actual Agent Actor', async () => {
    const owner = await addMember(workspace, 'member');
    const context = await connection(owner.principal);
    const { before, after, moving } = await column();
    const result = await moveIssue(
      owner.principal,
      moving.id,
      { beforeId: before.id, afterId: after.id },
      context,
    );
    expect(result.rebalanced).toHaveLength(3);
    expect(result.rebalanced.every((issue) => issue.teamId === workspace.teamId)).toBe(true);
    expect(result.actions.every((action) => action.actor?.type === 'agent')).toBe(true);
    expect(result.issue.sortOrder).toBe(1536);
  });
});
