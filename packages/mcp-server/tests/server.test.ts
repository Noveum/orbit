import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createIssue } from '@orbit/core';
import type { McpIdentity, Principal } from '@orbit/shared/policy';
import { resolveUserId } from '../src/resolve.ts';
import { createOrbitMcpServer } from '../src/server.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../src/test-helpers.ts';
import { allowTools, defineTool } from '../src/tools/support.ts';

const agentIdentity: McpIdentity = {
  kind: 'agent',
  id: 'agent-identity',
  name: 'Build assistant',
};
let workspace: TestWorkspace;
const clients: Client[] = [];
const servers: McpServer[] = [];

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await Promise.all(servers.map((server) => server.close()));
});

async function connected(
  principal: Principal,
  identity: McpIdentity = { kind: 'legacy' },
  scopes = 'orbit.read orbit.write',
) {
  const server = createOrbitMcpServer(principal, scopes, 'Workspace advisory context.', identity);
  const client = new Client({ name: 'identity-test', version: '1' });
  clients.push(client);
  servers.push(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function payload(result: CallToolResult): Record<string, unknown> {
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('The tool returned no text payload.');
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe('explicit agent connections', () => {
  it('exposes the pure read tools and no direct or indirect writes', async () => {
    const legacy = await connected(workspace.admin);
    const agent = await connected(workspace.admin, agentIdentity);
    const fullTools = (await legacy.client.listTools()).tools;
    const offered = (await agent.client.listTools()).tools;
    const offeredNames = offered.map((tool) => tool.name);
    const pureReadNames = fullTools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name);
    expect(offeredNames.sort()).toEqual([...pureReadNames, 'get_agent_identity'].sort());
    expect(offered.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    for (const name of [
      'create_issue',
      'create_sub_issues',
      'bulk_update_issues',
      'move_to_cycle',
      'set_relation',
      'remove_relation',
      'mark_issue_duplicate',
      'add_comment',
      'attach_file',
      'archive_issue',
      'delete_issue',
      'list_inbox_conversations',
    ]) {
      expect(offeredNames).not.toContain(name);
      expect((await agent.client.callTool({ name, arguments: {} })).isError).toBe(true);
    }
    expect(agent.client.getInstructions()).toContain('read-only');
    expect(agent.client.getInstructions()).toContain('Human Principal');
    expect(agent.client.getInstructions()).toContain('Workspace advisory context.');
    expect(agent.client.getInstructions()).not.toContain('before writing');
  });

  it('keeps me and my issues on the Human Principal and provides explicit agent identity', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Human responsibility',
      assigneeId: workspace.admin.userId,
    });
    const { client } = await connected(workspace.admin, agentIdentity);
    const me = payload(
      (await client.callTool({ name: 'get_me', arguments: {} })) as CallToolResult,
    );
    expect(me['user']).toMatchObject({ id: workspace.admin.userId });
    expect(await resolveUserId(workspace.admin, 'me')).toBe(workspace.admin.userId);
    const mine = payload(
      (await client.callTool({ name: 'list_my_issues', arguments: {} })) as CallToolResult,
    );
    expect(mine['issues']).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: issue.id })]),
    );
    const identity = payload(
      (await client.callTool({ name: 'get_agent_identity', arguments: {} })) as CallToolResult,
    );
    expect(identity).toEqual({
      agent: { id: agentIdentity.id, name: agentIdentity.name },
      readOnly: true,
    });
    expect(JSON.stringify(identity)).not.toMatch(/grant|token|clientId/);
  });

  it('requires a read scope even for explicit agent identity', async () => {
    const { client } = await connected(workspace.admin, agentIdentity, 'orbit.write');
    await expect(client.listTools()).rejects.toThrow('Method not found');
    await expect(client.callTool({ name: 'get_agent_identity', arguments: {} })).rejects.toThrow(
      'Method not found',
    );
  });

  it('rechecks the connection policy inside every registered callback', async () => {
    const { client, server } = await connected(workspace.admin);
    let effects = 0;
    for (const [name, readOnly, agentSafe] of [
      ['test_write', false, true],
      ['test_side_effect_read', true, false],
    ] as const) {
      defineTool(
        server,
        { name, title: name, description: name, readOnly, agentSafe, inputSchema: {} },
        () => {
          effects += 1;
          return Promise.resolve({});
        },
      );
    }
    allowTools(server, { reads: true, writes: true, identity: agentIdentity });
    for (const name of ['test_write', 'test_side_effect_read']) {
      const result = (await client.callTool({ name, arguments: {} })) as CallToolResult;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('cannot perform that operation');
    }
    expect(effects).toBe(0);
  });

  it('preserves legacy scope access to side effect reads and Human write tools', async () => {
    const reader = await connected(workspace.admin, { kind: 'legacy' }, 'orbit.read');
    const tools = (await reader.client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toContain('list_inbox_conversations');
    expect(
      tools.find((tool) => tool.name === 'list_inbox_conversations')?.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      (await reader.client.callTool({ name: 'list_inbox_conversations', arguments: {} })).isError,
    ).not.toBe(true);
    const writer = await connected(workspace.admin, { kind: 'legacy' }, 'orbit.write');
    const created = (await writer.client.callTool({
      name: 'create_issue',
      arguments: { team: workspace.teamKey, title: 'Legacy writer' },
    })) as CallToolResult;
    expect(created.isError).not.toBe(true);
    expect((await writer.client.listTools()).tools.map((tool) => tool.name)).not.toContain(
      'get_agent_identity',
    );
  });
});
