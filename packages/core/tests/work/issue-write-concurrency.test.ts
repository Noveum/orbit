import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, db, eq, schema, sql } from '@orbit/db';
import { PgDialect } from 'drizzle-orm/pg-core';
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
import { createCycle } from '../../src/work/cycle-service.ts';
import { createIssue, createSubIssues, moveIssue } from '../../src/work/issue-service.ts';

const SECRET = 'issue-write-concurrency-test-secret';
const original = {
  mcp: process.env['ORBIT_AGENT_MCP'],
  write: process.env['ORBIT_AGENT_ISSUE_WRITE'],
  secret: process.env['BETTER_AUTH_SECRET'],
};
let workspace: Workspace;
const pools: ReturnType<typeof postgres>[] = [];

function connectionPool(max: number) {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('Missing test database.');
  const pool = postgres(url, { max });
  pools.push(pool);
  return pool;
}

function transactionOutcome(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return result.status;
  let error: unknown = result.reason;
  while (error instanceof Error) {
    if (error instanceof postgres.PostgresError) return error.code;
    error = error.cause;
  }
  return result.status;
}

async function pauseCycleTransaction<T>(
  first: () => Promise<T>,
  second: () => Promise<unknown>,
): Promise<readonly PromiseSettledResult<unknown>[]> {
  const concurrent = drizzle({ client: connectionPool(4), schema, casing: 'snake_case' });
  const transactionDescriptor = Object.getOwnPropertyDescriptor(db, 'transaction');
  const held = Promise.withResolvers<number>();
  const resumed = Promise.withResolvers<void>();
  const dialect = new PgDialect();
  let intercepted = false;
  Object.defineProperty(db, 'transaction', {
    configurable: true,
    value: (...args: Parameters<typeof db.transaction>) =>
      concurrent.transaction((tx) => {
        if (!intercepted) {
          intercepted = true;
          const execute = tx.execute.bind(tx);
          Object.defineProperty(tx, 'execute', {
            configurable: true,
            value: async (...executeArgs: Parameters<typeof tx.execute>) => {
              const result = await execute(...executeArgs);
              const input = executeArgs[0];
              const query =
                typeof input === 'string' ? undefined : dialect.sqlToQuery(input.getSQL());
              if (query?.params.includes(`cycle:${workspace.organizationId}`)) {
                const [backend] = await execute<{ pid: number }>(
                  sql`select pg_backend_pid() as pid`,
                );
                if (backend === undefined) throw new Error('Missing transaction backend.');
                held.resolve(backend.pid);
                await resumed.promise;
              }
              return result;
            },
          });
        }
        return args[0](tx);
      }, args[1]),
  });
  let tasks: Promise<readonly PromiseSettledResult<unknown>[]> | undefined;
  try {
    const firstResult = Promise.allSettled([first()]);
    const pid = await held.promise;
    const secondResult = Promise.allSettled([second()]);
    tasks = Promise.all([firstResult, secondResult]).then((results) => results.flat());
    const observer = connectionPool(1);
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [blocked] = await observer<{ waiting: boolean }[]>`
        select exists(select 1 from pg_stat_activity
          where datname = current_database() and ${pid} = any(pg_blocking_pids(pid))) as waiting
      `;
      waiting = blocked?.waiting === true;
      if (waiting) break;
      await Bun.sleep(10);
    }
    resumed.resolve();
    const results = await tasks;
    expect(waiting).toBe(true);
    return results;
  } finally {
    resumed.resolve();
    await tasks;
    if (transactionDescriptor === undefined) Reflect.deleteProperty(db, 'transaction');
    else Object.defineProperty(db, 'transaction', transactionDescriptor);
  }
}

async function agentConnection(owner: Awaited<ReturnType<typeof addMember>>) {
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
        eq(schema.member.userId, owner.user.id),
      ),
    );
  if (membership === undefined) throw new Error('Missing Owner membership.');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'Concurrent writer',
    redirectUrls: 'https://example.test/callback',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: owner.user.id,
    clientId,
    name: 'Concurrent Agent',
    ownerNameSnapshot: owner.user.name,
    clientNameSnapshot: 'Concurrent writer',
  });
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId,
    userId: owner.user.id,
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
    userId: owner.user.id,
    scopes: 'orbit.read orbit.write',
    mcpGrantId: grantId,
    accessTokenExpiresAt: new Date(Date.now() + 120_000),
    refreshTokenExpiresAt: new Date(Date.now() + 240_000),
  });
  return agentIssueWriteContext(
    await verifyMcpAccessToken(bindAgentMcpCredential(accessToken, grantId, SECRET)),
  );
}

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
  process.env['BETTER_AUTH_SECRET'] = SECRET;
  await resetDatabase();
  workspace = await createWorkspace('Concurrency');
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

describe('Issue write allocation across concurrent transactions', () => {
  it('orders Agent cycle creation after a sub-Issue transaction holding that cycle lock', async () => {
    const parent = (
      await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Cycle parent',
        assigneeId: null,
      })
    ).issue;
    const { cycle } = await createCycle(workspace.admin, {
      startsAt: new Date('2030-05-01').toISOString(),
      endsAt: new Date('2030-05-15').toISOString(),
    });
    const first = await addMember(workspace, 'member', { name: 'Sub-Issue Owner' });
    const second = await addMember(workspace, 'member', { name: 'Cycle Issue Owner' });
    const firstContext = await agentConnection(first);
    const secondContext = await agentConnection(second);
    const results = await pauseCycleTransaction(
      () =>
        createSubIssues(
          first.principal,
          { parentId: parent.id, issues: [{ title: 'Cycle child', cycleId: cycle.id }] },
          firstContext,
        ),
      () =>
        createIssue(
          second.principal,
          { teamId: workspace.teamId, title: 'Concurrent cycle Issue', cycleId: cycle.id },
          secondContext,
        ),
    );
    expect(results.map(transactionOutcome)).toEqual(['fulfilled', 'fulfilled']);
    const issues = await db.select().from(schema.issue);
    expect(issues).toHaveLength(3);
    expect(issues.filter((issue) => issue.cycleId === cycle.id)).toHaveLength(2);
    expect(new Set(issues.map((issue) => issue.identifier)).size).toBe(3);
  });

  it('orders Agent child creation after a concurrent parent move before updating the Team counter', async () => {
    const destination = await createTeam(workspace.admin, { name: 'Destination', key: 'DEST' });
    const destinationState = destination.states[0];
    if (destinationState === undefined) throw new Error('Missing destination state.');
    const parent = (
      await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Parent with concurrent direct child',
        assigneeId: null,
      })
    ).issue;
    const owner = await addMember(workspace, 'member', {
      name: 'Direct child Owner',
      teamIds: [workspace.teamId, destination.team.id],
    });
    const context = await agentConnection(owner);
    const results = await pauseCycleTransaction(
      () =>
        moveIssue(workspace.admin, parent.id, {
          teamId: destination.team.id,
          stateId: destinationState.id,
          cycleId: null,
        }),
      () =>
        createIssue(
          owner.principal,
          {
            teamId: destination.team.id,
            title: 'Concurrent direct child',
            parentId: parent.id,
          },
          context,
        ),
    );
    expect(results.map(transactionOutcome)).toEqual(['fulfilled', 'fulfilled']);
    const issues = await db.select().from(schema.issue);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.teamId === destination.team.id)).toBe(true);
    expect(issues.map((issue) => issue.number).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(issues.find((issue) => issue.creatorAgentId === context.identityId)?.parentId).toBe(
      parent.id,
    );
  });

  it('creates both Agents owned by different Humans after a shared Team lock releases', async () => {
    const first = await addMember(workspace, 'member', { name: 'First Owner' });
    const second = await addMember(workspace, 'member', { name: 'Second Owner' });
    const firstContext = await agentConnection(first);
    const secondContext = await agentConnection(second);
    const concurrent = drizzle({ client: connectionPool(4), schema, casing: 'snake_case' });
    const transactionDescriptor = Object.getOwnPropertyDescriptor(db, 'transaction');
    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: concurrent.transaction.bind(concurrent),
    });
    try {
      const blocker = connectionPool(1);
      const pending = await blocker.begin(async (tx) => {
        await tx`select id from team where id = ${workspace.teamId} for update`;
        const tasks = Promise.allSettled([
          createIssue(
            first.principal,
            { teamId: workspace.teamId, title: 'First concurrent Issue' },
            firstContext,
          ),
          createIssue(
            second.principal,
            { teamId: workspace.teamId, title: 'Second concurrent Issue' },
            secondContext,
          ),
        ]);
        let waiting = 0;
        for (let attempt = 0; attempt < 200; attempt += 1) {
          await tx`select pg_stat_clear_snapshot()`;
          const [row] = await tx<{ waiting: number }[]>`
            select count(*)::int as waiting from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and query like '%"team"%'
          `;
          waiting = row?.waiting ?? 0;
          if (waiting === 2) break;
          await Bun.sleep(10);
        }
        return { tasks, waiting };
      });
      const results = await pending.tasks;
      expect(pending.waiting).toBe(2);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const issues = await db.select().from(schema.issue);
      expect(issues).toHaveLength(2);
      expect(issues.map((issue) => issue.number).sort((a, b) => a - b)).toEqual([1, 2]);
      expect(new Set(issues.map((issue) => issue.creatorAgentId))).toEqual(
        new Set([firstContext.identityId, secondContext.identityId]),
      );
    } finally {
      if (transactionDescriptor === undefined) Reflect.deleteProperty(db, 'transaction');
      else Object.defineProperty(db, 'transaction', transactionDescriptor);
    }
  });

  it('allocates Human children from the locked current parent Team after a concurrent move', async () => {
    const destination = await createTeam(workspace.admin, { name: 'Destination', key: 'DEST' });
    const destinationState = destination.states[0];
    if (destinationState === undefined) throw new Error('Missing destination state.');
    const parent = (
      await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Parent to move',
        assigneeId: null,
      })
    ).issue;
    await createIssue(workspace.admin, {
      teamId: destination.team.id,
      title: 'Existing destination Issue',
      assigneeId: null,
    });
    const transactionDescriptor = Object.getOwnPropertyDescriptor(db, 'transaction');
    const transact = db.transaction.bind(db);
    let moved = false;
    Object.defineProperty(db, 'transaction', {
      configurable: true,
      value: async (...args: Parameters<typeof db.transaction>) => {
        if (!moved) {
          moved = true;
          await moveIssue(workspace.admin, parent.id, {
            teamId: destination.team.id,
            stateId: destinationState.id,
          });
        }
        return transact(...args);
      },
    });
    try {
      const created = await createSubIssues(workspace.admin, {
        parentId: parent.id,
        issues: [{ title: 'Child in current Team' }],
      });
      expect(moved).toBe(true);
      expect(created.issues[0]?.teamId).toBe(destination.team.id);
      expect(created.issues[0]?.identifier).toBe('DEST-3');
      const [source] = await db
        .select()
        .from(schema.team)
        .where(eq(schema.team.id, workspace.teamId));
      expect(source?.issueCounter).toBe(2);
      const destinationIssues = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.teamId, destination.team.id));
      expect(destinationIssues.map((issue) => issue.number).sort((a, b) => a - b)).toEqual([
        1, 2, 3,
      ]);
    } finally {
      if (transactionDescriptor === undefined) Reflect.deleteProperty(db, 'transaction');
      else Object.defineProperty(db, 'transaction', transactionDescriptor);
    }
  });
});
