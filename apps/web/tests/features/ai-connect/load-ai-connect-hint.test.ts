import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as core from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, schema } from '@orbit/db';
import { aiConnectHintVisible } from '@/features/ai-connect/load-ai-connect-hint.ts';

let workspace: Workspace;

async function grant(userId: string, revoked: boolean): Promise<void> {
  const clientId = `client-${crypto.randomUUID()}`;
  await db.insert(schema.oauthApplication).values({
    id: clientId,
    name: 'Claude',
    clientId,
    redirectUrls: 'https://claude.ai/callback',
    type: 'web',
  });
  await db.insert(schema.mcpGrant).values({
    id: crypto.randomUUID(),
    clientId,
    userId,
    organizationId: workspace.admin.organizationId,
    scopes: 'orbit.read orbit.write',
    ...(revoked ? { revokedAt: new Date() } : {}),
  });
}

afterEach(() => {
  grantLookups.mockRestore();
});

let grantLookups: ReturnType<typeof spyOn>;

beforeEach(async () => {
  grantLookups = spyOn(core, 'listMcpGrants');
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('aiConnectHintVisible', () => {
  it('shows the hint to a user with no connected AI client', async () => {
    expect(await aiConnectHintVisible(workspace.adminUser.id)).toBe(true);
  });

  it('keeps showing it when the only grant has been revoked', async () => {
    await grant(workspace.adminUser.id, true);
    expect(await aiConnectHintVisible(workspace.adminUser.id)).toBe(true);
  });

  it('hides it once the user has an active grant', async () => {
    await grant(workspace.adminUser.id, false);
    expect(await aiConnectHintVisible(workspace.adminUser.id)).toBe(false);
  });

  it('hides it after the user dismissed it, without looking up their grants', async () => {
    await core.dismissAiConnectHint(workspace.adminUser.id);
    expect(await aiConnectHintVisible(workspace.adminUser.id)).toBe(false);
    expect(grantLookups).not.toHaveBeenCalled();
  });
});
