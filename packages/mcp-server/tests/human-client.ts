import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getOrganization, verifyMcpAccessToken } from '@orbit/core';
import { createOrbitMcpServer } from '../src/server.ts';
import type { TestClient } from '../src/test-helpers.ts';

export async function connectHuman(token: string): Promise<TestClient> {
  const identity = await verifyMcpAccessToken(token);
  const organization = await getOrganization(identity.organizationId);
  const server = createOrbitMcpServer(
    identity.principal,
    identity.scopes,
    organization.agentInstructions,
  );
  const client = new Client({ name: 'human-tool-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  return {
    client,
    call,
    async result(name, args = {}) {
      const result = await call(name, args);
      if (result.isError) throw new Error(JSON.stringify(result.content));
      const first = result.content[0];
      if (first?.type !== 'text') throw new Error('Missing tool response');
      return JSON.parse(first.text) as Record<string, unknown>;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
