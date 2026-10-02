import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createIssue, verifyMcpAccessToken } from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { syncActionSchema } from '@orbit/shared/events';
import {
  connect,
  createWorkspace,
  mintToken,
  resetDatabase,
  type TestClient,
} from '../../src/test-helpers.ts';
import { connectHuman } from '../human-client.ts';

const GATES = [
  'ORBIT_AGENT_IDENTITY_READ',
  'ORBIT_AGENT_CONSENT',
  'ORBIT_AGENT_ISSUE_WRITE',
  'ORBIT_ISSUE_OUTBOX_DISPATCH',
] as const;
const originalGates = new Map(GATES.map((gate) => [gate, process.env[gate]]));

interface Harness {
  readonly workspace: Awaited<ReturnType<typeof createWorkspace>>;
  readonly identity: Awaited<ReturnType<typeof verifyMcpAccessToken>>;
  readonly token: string;
  readonly agent: TestClient;
  readonly human: TestClient;
}

let closers: (() => Promise<void>)[] = [];

async function harness(): Promise<Harness> {
  await resetDatabase();
  const workspace = await createWorkspace('Nova');
  const token = await mintToken(workspace.organizationId, workspace.adminUser.id);
  const identity = await verifyMcpAccessToken(token);
  const agent = await connect(token);
  const human = await connectHuman(token);
  closers.push(
    () => agent.close(),
    () => human.close(),
  );
  return { workspace, identity, token, agent, human };
}

interface StoreCounts {
  readonly issues: number;
  readonly activities: number;
  readonly outbox: number;
  readonly notifications: number;
  readonly idempotency: number;
}

async function counts(): Promise<StoreCounts> {
  const [issues, activities, outbox, notifications, idempotency] = await Promise.all([
    db.select().from(schema.issue),
    db.select().from(schema.issueActivity),
    db.select().from(schema.issueOutbox),
    db.select().from(schema.notification),
    db.select().from(schema.mcpIdempotency),
  ]);
  return {
    issues: issues.length,
    activities: activities.length,
    outbox: outbox.length,
    notifications: notifications.length,
    idempotency: idempotency.length,
  };
}

function errorOf(result: CallToolResult): { code: string; reason: string | null } {
  const [first] = result.content;
  if (first === undefined || first.type !== 'text') throw new Error('The tool returned no text.');
  const parsed = JSON.parse(first.text) as { error?: { code?: unknown; details?: unknown } };
  const details = parsed.error?.details;
  const reason =
    typeof details === 'object' && details !== null && 'reason' in details
      ? String((details as { reason: unknown }).reason)
      : null;
  return { code: String(parsed.error?.code), reason };
}

beforeEach(() => {
  for (const gate of GATES) process.env[gate] = 'true';
  closers = [];
});

afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  for (const gate of GATES) {
    const original = originalGates.get(gate);
    if (original === undefined) delete process.env[gate];
    else process.env[gate] = original;
  }
});

describe('agent issue tools', () => {
  it('P0-IDEM-1 replays one agent issue for the same key and rejects a different request', async () => {
    const { workspace, agent } = await harness();
    const args = {
      team: workspace.teamKey,
      title: 'Investigate',
      assignee: 'agent',
      idempotencyKey: 'key-1',
    };
    const first = await agent.result('create_issue', args);
    const firstIssue = first['issue'] as { id: string; identifier: string };
    expect(firstIssue.identifier).toBeString();
    const after = await counts();
    expect(after).toEqual({
      issues: 1,
      activities: 1,
      outbox: 3,
      notifications: 1,
      idempotency: 1,
    });
    const outboxRows = await db
      .select({ payload: schema.issueOutbox.payload })
      .from(schema.issueOutbox);
    expect(outboxRows.map((row) => syncActionSchema.parse(row.payload).model).sort()).toEqual([
      'issue',
      'notification',
      'notification_conversation',
    ]);

    const replay = await agent.result('create_issue', args);
    expect((replay['issue'] as { id: string }).id).toBe(firstIssue.id);
    expect(replay['deltas']).toEqual(first['deltas']);
    expect(await counts()).toEqual(after);

    const reused = await agent.call('create_issue', { ...args, title: 'Something else' });
    expect(reused.isError).toBe(true);
    expect(errorOf(reused)).toEqual({ code: 'conflict', reason: 'idempotency_conflict' });
    expect(await counts()).toEqual(after);
  });

  it('P0-MCP-1 creates an unassigned issue when assignee is null', async () => {
    const { workspace, agent } = await harness();
    const created = await agent.result('create_issue', {
      team: workspace.teamKey,
      title: 'Leave this unassigned',
      assignee: null,
    });
    const issue = created['issue'] as { id: string };
    const [stored] = await db
      .select({
        assigneeId: schema.issue.assigneeId,
        assigneeAgentId: schema.issue.assigneeAgentId,
      })
      .from(schema.issue)
      .where(eq(schema.issue.id, issue.id));

    expect(stored).toEqual({ assigneeId: null, assigneeAgentId: null });
  });

  it('P0-IDEM-1 serializes two concurrent creates that share one idempotency key', async () => {
    const { workspace, token, agent } = await harness();
    const second = await connect(token);
    closers.push(() => second.close());
    const args = { team: workspace.teamKey, title: 'One issue', idempotencyKey: 'key-2' };
    const [left, right] = await Promise.all([
      agent.result('create_issue', args),
      second.result('create_issue', args),
    ]);
    expect((left['issue'] as { id: string }).id).toBe((right['issue'] as { id: string }).id);
    expect(await counts()).toEqual({
      issues: 1,
      activities: 1,
      outbox: 1,
      notifications: 0,
      idempotency: 1,
    });
  });

  it('P0-MCP-1 keeps the agent issue write gate closed until it is enabled', async () => {
    const { workspace, agent, human } = await harness();
    delete process.env['ORBIT_AGENT_ISSUE_WRITE'];
    const denied = await agent.call('create_issue', {
      team: workspace.teamKey,
      title: 'Blocked',
      assignee: 'agent',
    });
    expect(denied.isError).toBe(true);
    expect(errorOf(denied)).toEqual({ code: 'forbidden', reason: null });
    expect((await counts()).issues).toBe(0);

    const me = await agent.result('get_me');
    expect((me['actor'] as { type: string }).type).toBe('agent');
    const queue = await agent.result('list_agent_issues');
    expect(queue['issues']).toEqual([]);

    const created = await human.result('create_issue', {
      team: workspace.teamKey,
      title: 'Human issue',
    });
    expect((created['issue'] as { title: string }).title).toBe('Human issue');
    expect((await counts()).issues).toBe(1);
  });

  it('P0-MCP-1 reports the principal as the human and the agent as the actor', async () => {
    const { workspace, identity, agent, human } = await harness();
    const me = await agent.result('get_me');
    expect(me['principal']).toMatchObject({ type: 'user', id: workspace.adminUser.id });
    expect(me['actor']).toMatchObject({ type: 'agent', id: identity.agentIdentityId });
    expect(me['agent']).toMatchObject({
      id: identity.agentIdentityId,
      grantId: identity.grantId,
      clientId: identity.clientId,
    });
    expect(me['grant']).toMatchObject({ id: identity.grantId, connection: 'connected' });

    const humanMe = await human.result('get_me');
    expect(humanMe['agent']).toBeNull();
    expect(humanMe['grant']).toBeNull();
    expect(humanMe['actor']).toMatchObject({ type: 'user', id: workspace.adminUser.id });
  });

  it('P0-MCP-1 keeps list_agent_issues and search_issues inside the agent queue', async () => {
    const { workspace, identity, agent, human } = await harness();
    await human.result('create_issue', {
      team: workspace.teamKey,
      title: 'Owner work',
      assignee: 'me',
    });
    const mine = await agent.result('create_issue', {
      team: workspace.teamKey,
      title: 'Agent work',
      assignee: 'agent',
    });
    const agentIssueId = (mine['issue'] as { id: string }).id;

    const queue = await agent.result('list_agent_issues');
    const queued = queue['issues'] as { id: string; assigneeAgentId: string | null }[];
    expect(queued.map((issue) => issue.id)).toEqual([agentIssueId]);
    expect(queued[0]?.assigneeAgentId).toBe(identity.agentIdentityId);

    const search = await agent.result('search_issues', { assignee: 'agent' });
    expect((search['issues'] as { id: string }[]).map((issue) => issue.id)).toEqual([agentIssueId]);

    const myIssues = await agent.result('list_my_issues');
    const titles = (myIssues['issues'] as { title: string }[]).map((issue) => issue.title);
    expect(titles).toContain('Owner work');
    expect(titles).not.toContain('Agent work');
  });

  it('P0-MCP-1 rejects the agent reference from a human session', async () => {
    const { workspace, human } = await harness();
    const expected = { code: 'validation_failed', reason: 'agent_ref_in_human_session' };
    expect(errorOf(await human.call('list_agent_issues'))).toEqual(expected);
    expect(errorOf(await human.call('search_issues', { assignee: 'agent' }))).toEqual(expected);
    expect(
      errorOf(
        await human.call('create_issue', {
          team: workspace.teamKey,
          title: 'Nope',
          assignee: 'agent',
        }),
      ),
    ).toEqual(expected);
    expect((await counts()).issues).toBe(0);
  });

  it('P0-AUTH-1 applies role and team downgrades on the next authenticated MCP request', async () => {
    const { workspace, agent } = await harness();
    const created = await agent.result('create_issue', {
      team: workspace.teamKey,
      title: 'Permission change',
    });
    const issueId = (created['issue'] as { id: string }).id;
    await db
      .update(schema.member)
      .set({ role: 'guest' })
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, workspace.adminUser.id),
        ),
      );
    const deniedWrite = await agent.call('update_issue', {
      issue: issueId,
      title: 'Must not update',
    });
    expect(errorOf(deniedWrite).code).toBe('forbidden');
    expect(
      ((await agent.result('get_issue', { issue: issueId }))['issue'] as { title: string }).title,
    ).toBe('Permission change');

    await db
      .delete(schema.teamMember)
      .where(
        and(
          eq(schema.teamMember.teamId, workspace.teamId),
          eq(schema.teamMember.userId, workspace.adminUser.id),
        ),
      );
    expect(errorOf(await agent.call('get_issue', { issue: issueId })).code).toBe('not_found');
    expect(
      errorOf(
        await agent.call('create_issue', {
          team: workspace.teamKey,
          title: 'Outside the team',
        }),
      ).code,
    ).toBe('not_found');
  });

  it('P0-LIFE-1 exposes only the tools permitted by read-only and write-only grants', async () => {
    const { workspace } = await harness();
    const humanIssue = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Read scope',
    });
    const readToken = await mintToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'Read-only client',
      'orbit.read',
    );
    const writerToken = await mintToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'Write-only client',
      'orbit.write',
    );
    const reader = await connect(readToken);
    const writer = await connect(writerToken);
    closers.push(
      () => reader.close(),
      () => writer.close(),
    );

    const readTools = (await reader.client.listTools()).tools.map((tool) => tool.name);
    expect(readTools).toContain('get_issue');
    expect(readTools).not.toContain('create_issue');
    expect(
      (
        (await reader.result('get_issue', { issue: humanIssue.issue.id }))['issue'] as {
          title: string;
        }
      ).title,
    ).toBe('Read scope');

    const writeTools = (await writer.client.listTools()).tools.map((tool) => tool.name);
    expect(writeTools).toContain('create_issue');
    expect(writeTools).not.toContain('get_issue');
    const created = await writer.result('create_issue', {
      team: workspace.teamKey,
      title: 'Write scope',
    });
    expect((created['issue'] as { title: string }).title).toBe('Write scope');
  });

  it('P0-RT-1 keeps the grant out of the public issue payload', async () => {
    const { workspace, identity, agent } = await harness();
    const created = await agent.result('create_issue', {
      team: workspace.teamKey,
      title: 'Private grant',
      idempotencyKey: 'key-3',
    });
    expect(JSON.stringify(created)).not.toContain(identity.grantId);
    expect(JSON.stringify(created)).not.toContain('grantId');

    const staged = await db.select().from(schema.issueOutbox);
    expect(staged).toHaveLength(1);
    expect(staged.every((row) => JSON.stringify(row.payload).includes(identity.grantId))).toBe(
      true,
    );
    const payload = staged[0]?.payload as
      | { attribution?: { actor?: { type?: string }; principal?: { type?: string } } }
      | undefined;
    expect(payload?.attribution?.actor?.type).toBe('agent');
    expect(payload?.attribution?.principal?.type).toBe('user');
  });
});
