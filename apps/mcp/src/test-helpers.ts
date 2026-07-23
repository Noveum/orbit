import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createApiKey, createOrganization, resolvePrincipal } from '@orbit/core';
import { db, schema, sql } from '@orbit/db';
import type { OrgRole } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';
import { createMcpHttpServer, MCP_PATH, type McpHttpServer } from './server.ts';

const TEST_DATABASE_NAME = /^orbit_test(?:_[a-z0-9]+)*$/;

export async function resetDatabase(): Promise<void> {
  const [current] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (current === undefined || !TEST_DATABASE_NAME.test(String(current['name']))) {
    throw new Error(
      `resetDatabase refuses to truncate "${current?.['name'] ?? 'unknown'}". Point DATABASE_URL at a database matching ${String(TEST_DATABASE_NAME)}.`,
    );
  }
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((row) => `"${row['tablename']}"`).join(', ');
  if (tables.length === 0) return;
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
  await db.execute(sql`select setval('sync_id_seq', 1, false)`);
}

export async function createUser(name: string): Promise<typeof schema.user.$inferSelect> {
  const id = randomUUID();
  const handle = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${id.slice(0, 8)}`;
  const [row] = await db
    .insert(schema.user)
    .values({ id, name, email: `${handle}@orbit.test`, handle, emailVerified: true })
    .returning();
  if (row === undefined) throw new Error('Could not create the test user.');
  return row;
}

export interface TestWorkspace {
  readonly organizationId: string;
  readonly teamId: string;
  readonly teamKey: string;
  readonly admin: Principal;
  readonly adminUser: typeof schema.user.$inferSelect;
}

export async function createWorkspace(name = 'Nova'): Promise<TestWorkspace> {
  const adminUser = await createUser('Ada Admin');
  const bootstrap = await createOrganization(adminUser.id, {
    name,
    slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
  });
  const admin = await resolvePrincipal(adminUser.id, bootstrap.organization.id);
  return {
    organizationId: bootstrap.organization.id,
    teamId: bootstrap.team.id,
    teamKey: bootstrap.team.key,
    admin,
    adminUser,
  };
}

export async function addMember(
  workspace: TestWorkspace,
  role: OrgRole,
  name = `${role} person`,
): Promise<{ principal: Principal; user: typeof schema.user.$inferSelect }> {
  const user = await createUser(name);
  await db.insert(schema.member).values({
    id: randomUUID(),
    organizationId: workspace.organizationId,
    userId: user.id,
    role,
  });
  await db
    .insert(schema.teamMember)
    .values({ id: randomUUID(), teamId: workspace.teamId, userId: user.id });
  const principal = await resolvePrincipal(user.id, workspace.organizationId);
  return { principal, user };
}

export async function mintKey(
  organizationId: string,
  userId: string,
  name = 'test key',
): Promise<string> {
  const created = await createApiKey({ organizationId, userId, name });
  return created.key;
}

export interface TestClient {
  readonly client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  result(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function payloadOf(result: CallToolResult): Record<string, unknown> {
  const [first] = result.content;
  if (first === undefined || first.type !== 'text') {
    throw new Error('The tool returned no text content.');
  }
  const parsed: unknown = JSON.parse(first.text);
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('The tool returned no object.');
  return parsed as Record<string, unknown>;
}

export async function connect(server: McpHttpServer, apiKey: string): Promise<TestClient> {
  const client = new Client({ name: 'orbit-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${server.port}${MCP_PATH}`),
    { requestInit: { headers: { authorization: `Bearer ${apiKey}` } } },
  );
  await client.connect(transport as unknown as Transport);
  return {
    client,
    call: (name, args = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    async result(name, args = {}) {
      const called = (await client.callTool({ name, arguments: args })) as CallToolResult;
      if (called.isError === true) {
        throw new Error(`tool ${name} failed: ${JSON.stringify(called.content)}`);
      }
      return payloadOf(called);
    },
    close: () => client.close(),
  };
}

export function errorPayload(result: CallToolResult): { code: string; message: string } {
  const parsed = payloadOf(result);
  const error = parsed['error'];
  if (typeof error !== 'object' || error === null) throw new Error('No error payload.');
  const shape = error as { code?: unknown; message?: unknown };
  return { code: String(shape.code), message: String(shape.message) };
}

export function startServer(): Promise<McpHttpServer> {
  return createMcpHttpServer({ port: 0, host: '127.0.0.1', shutdownGraceMs: 25 });
}
