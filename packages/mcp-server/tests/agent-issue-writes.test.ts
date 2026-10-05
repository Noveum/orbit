import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  bindAgentMcpCredential,
  createIssue,
  getIssue,
  revokeMcpGrant,
  verifyMcpAccessToken,
} from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { agentIssueWriteContext } from '../../core/src/work/agent-issue-context.ts';
import { createOrbitMcpServer } from '../src/server.ts';
import { connect, type TestClient } from '../src/test-helpers.ts';

const SECRET = 'mcp-agent-issue-writing-test-secret';
const original = {
  mcp: process.env['ORBIT_AGENT_MCP'],
  write: process.env['ORBIT_AGENT_ISSUE_WRITE'],
  secret: process.env['BETTER_AUTH_SECRET'],
};
const clients: Client[] = [];
const servers: McpServer[] = [];
const httpClients: TestClient[] = [];
let workspace: Workspace;
let owner: Awaited<ReturnType<typeof addMember>>;

async function connection(scopes = 'orbit.read orbit.write') {
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
  if (membership === undefined) throw new Error('Missing membership.');
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    clientId,
    name: 'MCP writer',
    redirectUrls: 'https://example.test/callback',
    type: 'public',
  });
  await db.insert(schema.agentIdentity).values({
    id: identityId,
    organizationId: workspace.organizationId,
    ownerUserId: owner.user.id,
    clientId,
    name: 'MCP Agent',
    ownerNameSnapshot: owner.user.name,
    clientNameSnapshot: 'MCP writer',
  });
  await db.insert(schema.mcpGrant).values({
    id: grantId,
    clientId,
    userId: owner.user.id,
    organizationId: workspace.organizationId,
    scopes,
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
    scopes,
    mcpGrantId: grantId,
    accessTokenExpiresAt: new Date(Date.now() + 120_000),
    refreshTokenExpiresAt: new Date(Date.now() + 240_000),
  });
  const token = bindAgentMcpCredential(accessToken, grantId, SECRET);
  const access = await verifyMcpAccessToken(token);
  return { access, context: agentIssueWriteContext(access), token };
}

async function http(token: string) {
  const client = await connect(token);
  httpClients.push(client);
  return client;
}

async function memory(agent: Awaited<ReturnType<typeof connection>>, trusted = true) {
  const server = createOrbitMcpServer(
    owner.principal,
    agent.access.scopes,
    '',
    agent.access.identity,
    trusted ? agent.context : undefined,
  );
  const client = new Client({ name: 'agent-write-test', version: '1' });
  clients.push(client);
  servers.push(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function payload(result: CallToolResult): Record<string, unknown> {
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('Missing payload.');
  return JSON.parse(first.text) as Record<string, unknown>;
}

function issueOf(result: Record<string, unknown>): { id: string; identifier: string } {
  const issue = result['issue'];
  if (typeof issue !== 'object' || issue === null) throw new Error('Missing issue.');
  return issue as { id: string; identifier: string };
}

async function cycle(target = workspace) {
  const [created] = await db
    .insert(schema.cycle)
    .values({
      id: randomUUID(),
      organizationId: target.organizationId,
      teamId: target.teamId,
      number: 100,
      name: 'MCP test cycle',
      startsAt: new Date('2026-10-01'),
      endsAt: new Date('2026-10-15'),
    })
    .returning();
  if (created === undefined) throw new Error('Missing cycle.');
  return created;
}

beforeEach(async () => {
  process.env['ORBIT_AGENT_MCP'] = 'true';
  process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
  process.env['BETTER_AUTH_SECRET'] = SECRET;
  await resetDatabase();
  workspace = await createWorkspace('Mcpwrites');
  owner = await addMember(workspace, 'member', { name: 'Agent owner' });
});

afterEach(async () => {
  await Promise.all([
    ...clients.splice(0).map((client) => client.close()),
    ...servers.splice(0).map((server) => server.close()),
    ...httpClients.splice(0).map((client) => client.close()),
  ]);
  for (const [key, value] of [
    ['ORBIT_AGENT_MCP', original.mcp],
    ['ORBIT_AGENT_ISSUE_WRITE', original.write],
    ['BETTER_AUTH_SECRET', original.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Agent MCP Issue write tools', () => {
  it('retains reads with writing off, rejects read-only grants and requires a trusted context', async () => {
    const agent = await connection();
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'false';
    const disabled = await http(agent.token);
    const names = (await disabled.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('get_agent_identity');
    expect(await disabled.result('get_agent_identity', {})).toMatchObject({ readOnly: true });
    expect(names).not.toContain('create_issue');
    expect(
      (await disabled.call('create_issue', { team: workspace.teamId, title: 'Disabled' })).isError,
    ).toBe(true);
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
    const readOnly = await http((await connection('orbit.read')).token);
    expect((await readOnly.client.listTools()).tools.map((tool) => tool.name)).not.toContain(
      'update_issue',
    );
    const untrusted = await memory(agent, false);
    expect((await untrusted.listTools()).tools.map((tool) => tool.name)).not.toContain(
      'create_issue',
    );
    expect(await db.select().from(schema.issue)).toHaveLength(0);
  });

  it('offers every integrated Issue mutation and denies all remaining write paths', async () => {
    const agent = await connection();
    const client = await http(agent.token);
    const names = (await client.client.listTools()).tools.map((tool) => tool.name);
    expect(await client.result('get_agent_identity', {})).toMatchObject({ readOnly: false });
    for (const name of [
      'create_issue',
      'update_issue',
      'create_sub_issues',
      'bulk_update_issues',
      'move_to_cycle',
      'move_issue',
      'archive_issue',
      'unarchive_issue',
      'delete_issue',
      'set_relation',
      'remove_relation',
      'mark_issue_duplicate',
    ])
      expect(names).toContain(name);
    for (const name of [
      'add_comment',
      'attach_file',
      'create_project',
      'create_doc',
      'invite_member',
      'list_inbox_conversations',
    ]) {
      expect(names).not.toContain(name);
      expect((await client.call(name, {})).isError).toBe(true);
    }
  });

  it('executes create, self-assignment, bulk, sub-issues, cycle, duplicate, relations, archive and delete as the Agent', async () => {
    const agent = await connection();
    const client = await http(agent.token);
    expect(
      (
        await client.call('create_issue', {
          team: workspace.teamId,
          title: 'Forged actor',
          creatorAgentId: randomUUID(),
          grantId: randomUUID(),
        })
      ).isError,
    ).toBe(true);
    expect(await db.select().from(schema.issue)).toHaveLength(0);
    const parent = issueOf(
      await client.result('create_issue', {
        team: workspace.teamId,
        title: 'Agent parent',
        assignee: 'agent',
      }),
    );
    expect(await getIssue(workspace.admin, parent.id)).toMatchObject({
      creatorId: null,
      creatorAgentId: agent.context.identityId,
      assigneeAgentId: agent.context.identityId,
      ownerUserId: owner.user.id,
    });
    const child = issueOf(
      await client.result('create_issue', { team: workspace.teamId, title: 'Agent child' }),
    );
    expect((await getIssue(workspace.admin, child.id)).assigneeAgentId).toBeNull();
    await client.result('update_issue', { issue: child.id, assignee: 'agent' });
    await client.result('bulk_update_issues', {
      issues: [parent.id, child.id],
      patch: { priority: 'urgent' },
    });
    expect((await getIssue(workspace.admin, parent.id)).priority).toBe(1);
    await client.result('create_sub_issues', {
      parent: parent.id,
      issues: [{ title: 'Sub one' }, { title: 'Sub two' }],
    });
    const children = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.parentId, parent.id));
    expect(children).toHaveLength(2);
    expect(children.every((row) => row.creatorAgentId === agent.context.identityId)).toBe(true);
    const sprint = await cycle();
    await client.result('move_to_cycle', { issue: child.id, cycle: sprint.id });
    expect((await getIssue(workspace.admin, child.id)).cycleId).toBe(sprint.id);
    await client.result('move_issue', {
      issue: child.id,
      state: workspace.states.find((state) => state.category === 'started')?.id,
    });
    await client.result('set_relation', {
      issue: child.id,
      relatedIssue: parent.id,
      type: 'related',
    });
    await client.result('remove_relation', {
      issue: child.id,
      relatedIssue: parent.id,
      type: 'related',
    });
    await client.result('mark_issue_duplicate', { issue: child.id, survivorIssue: parent.id });
    await client.result('archive_issue', { issue: child.id });
    await client.result('unarchive_issue', { issue: child.id });
    await client.result('update_issue', { issue: parent.id, assignee: null });
    expect(await getIssue(workspace.admin, parent.id)).toMatchObject({
      assigneeAgentId: null,
      ownerUserId: owner.user.id,
    });
    const activities = await db.select().from(schema.issueActivity);
    expect(activities.length).toBeGreaterThan(0);
    expect(
      activities.every(
        (activity) =>
          activity.actorType === 'agent' && activity.actorId === agent.context.identityId,
      ),
    ).toBe(true);
    await client.result('delete_issue', { issue: child.id });
    expect(JSON.stringify(await client.result('get_issue', { issue: parent.id }))).not.toContain(
      agent.context.grantId,
    );
  });

  it('rechecks execution after registration when the write gate closes or the exact Grant is revoked', async () => {
    const agent = await connection();
    const client = await memory(agent);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('create_issue');
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'false';
    const disabled = (await client.callTool({
      name: 'create_issue',
      arguments: { team: workspace.teamId, title: 'After gate' },
    })) as CallToolResult;
    expect(disabled.isError).toBe(true);
    process.env['ORBIT_AGENT_ISSUE_WRITE'] = 'true';
    await revokeMcpGrant(agent.context.grantId, owner.user.id);
    const revoked = (await client.callTool({
      name: 'create_issue',
      arguments: { team: workspace.teamId, title: 'After revoke' },
    })) as CallToolResult;
    expect(revoked.isError).toBe(true);
    expect(JSON.stringify(payload(revoked))).toContain('unauthorized');
    expect(await db.select().from(schema.issue)).toHaveLength(0);
  });

  it('rejects foreign resources before partial bulk, sub-issue, cycle or duplicate mutations', async () => {
    const agent = await connection();
    const client = await http(agent.token);
    const local = issueOf(
      await client.result('create_issue', { team: workspace.teamId, title: 'Local' }),
    );
    const foreign = await createWorkspace('Foreignmcp');
    const remote = (await createIssue(foreign.admin, { teamId: foreign.teamId, title: 'Remote' }))
      .issue;
    const sprint = await cycle(foreign);
    for (const [name, args] of [
      ['bulk_update_issues', { issues: [local.id, remote.id], patch: { priority: 'urgent' } }],
      [
        'create_sub_issues',
        {
          parent: local.id,
          issues: [{ title: 'Valid' }, { title: 'Invalid', state: remote.stateId }],
        },
      ],
      ['move_to_cycle', { issue: local.id, cycle: sprint.id }],
      ['mark_issue_duplicate', { issue: local.id, survivorIssue: remote.id }],
    ] as const)
      expect((await client.call(name, args)).isError).toBe(true);
    expect(await getIssue(workspace.admin, local.id)).toMatchObject({ priority: 0, cycleId: null });
    expect(
      await db.select().from(schema.issue).where(eq(schema.issue.parentId, local.id)),
    ).toHaveLength(0);
    expect(await db.select().from(schema.issueRelation)).toHaveLength(0);
  });
});
