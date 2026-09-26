import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createIssue, preparePersonalAgentConsent, recordMcpGrant } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { syncActionSchema } from '@orbit/shared/events';
import { mockSession } from '../../../../tests-support.ts';

let workspace: Workspace;
let activeUser: { id: string; name: string; email: string } | null = null;
const previousGate = process.env['ORBIT_AGENT_IDENTITY_READ'];

mockSession(() =>
  activeUser === null
    ? null
    : { user: activeUser, session: { activeOrganizationId: workspace.organizationId } },
);

const { PATCH } = await import(
  '../../../../src/app/api/integrations/mcp/agents/[identityId]/route.ts'
);

async function identityId(): Promise<string> {
  const clientId = `client_${randomUUID()}`;
  await db.insert(schema.oauthApplication).values({
    id: randomUUID(),
    name: 'Agent Client',
    clientId,
    redirectUrls: 'http://127.0.0.1:9000/callback',
    type: 'public',
    userId: workspace.adminUser.id,
  });
  const prepared = await db.transaction(async (tx) =>
    preparePersonalAgentConsent(tx, {
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      clientId,
      selection: { createAgent: { name: 'Researcher', avatar: null } },
    }),
  );
  return prepared.identity.id;
}

function patch(id: string, body: unknown): Promise<Response> {
  return PATCH(
    new Request(`http://localhost:3000/api/integrations/mcp/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ identityId: id }) },
  );
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  activeUser = workspace.adminUser;
  delete process.env['ORBIT_AGENT_IDENTITY_READ'];
});

afterEach(() => {
  if (previousGate === undefined) delete process.env['ORBIT_AGENT_IDENTITY_READ'];
  else process.env['ORBIT_AGENT_IDENTITY_READ'] = previousGate;
});

describe('MCP agent lifecycle API', () => {
  it('dispatches responsibility cleanup from the production route', async () => {
    const id = await identityId();
    const [identity] = await db
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, id));
    if (identity === undefined) throw new Error('Agent identity was not created');
    await recordMcpGrant({
      clientId: identity.clientId,
      userId: workspace.adminUser.id,
      organizationId: workspace.organizationId,
      scopes: 'orbit.read',
      agentIdentityId: id,
    });
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Delegated',
      assigneeAgentId: id,
    });
    process.env['ORBIT_AGENT_IDENTITY_READ'] = 'true';
    expect((await patch(id, { action: 'pause' })).status).toBe(200);
    const events = await db
      .select()
      .from(schema.issueOutbox)
      .where(eq(schema.issueOutbox.aggregateId, created.issue.id));
    const cleanup = events.find((row) => syncActionSchema.parse(row.payload).action === 'update');
    expect(cleanup?.deliveredAt).not.toBeNull();
  });

  it('stays closed by default and exposes pause, resume and delete through the shared policy', async () => {
    const id = await identityId();
    expect((await patch(id, { action: 'pause' })).status).toBe(404);

    process.env['ORBIT_AGENT_IDENTITY_READ'] = 'true';
    const member = await addMember(workspace, 'member');
    activeUser = member.user;
    expect((await patch(id, { action: 'pause' })).status).toBe(403);

    activeUser = workspace.adminUser;
    const paused = await patch(id, { action: 'pause' });
    expect(paused.status).toBe(200);
    expect((await paused.json()).identity.ownerDisabledAt).not.toBeNull();
    const resumed = await patch(id, { action: 'resume' });
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).identity.ownerDisabledAt).toBeNull();
    const deleted = await patch(id, { action: 'delete', reason: 'owner_request' });
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).identity.deletedReason).toBe('owner_request');
  });
});
