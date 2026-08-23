import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  addMember,
  connect,
  createWorkspace,
  mintToken,
  resetDatabase,
  type TestClient,
  type TestWorkspace,
} from '../../src/test-helpers.ts';

let workspace: TestWorkspace;
let admin: TestClient;
let guest: TestClient;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(await mintToken(workspace.organizationId, guestMember.user.id));
});

afterAll(async () => {
  await admin.close();
  await guest.close();
});

describe('analytics over mcp', () => {
  it('is registered when the token carries orbit.read, and refused when it does not', async () => {
    const { tools: adminTools } = await admin.client.listTools();
    const adminNames = adminTools.map((tool) => tool.name);
    expect(adminNames).toContain('get_analytics_overview');
    const readOnly = await connect(
      await mintToken(workspace.organizationId, workspace.adminUser.id, 'Reader', 'orbit.read'),
    );
    const { tools: readTools } = await readOnly.client.listTools();
    expect(readTools.map((t) => t.name)).toContain('get_analytics_overview');
    await readOnly.close();
    const noRead = await connect(
      await mintToken(workspace.organizationId, workspace.adminUser.id, 'Reader', 'orbit.write'),
    );
    const { tools: noReadTools } = await noRead.client.listTools();
    expect(noReadTools.map((t) => t.name)).not.toContain('get_analytics_overview');
    await noRead.close();
  });

  it('translates defaults and maps the response shape safely with stable IDs and resolved range', async () => {
    const result = await admin.result('get_analytics_overview', {});

    expect(result).toHaveProperty('asOf');
    expect(result).toHaveProperty('resolvedRange');
    expect(result).toHaveProperty('outliersWithheld');
    expect(result).not.toHaveProperty('outliers');

    const metrics = result['metrics'] as Record<string, unknown>[];

    for (const card of metrics) {
      expect(card).toHaveProperty('id');
      expect(card).toHaveProperty('metric');
      expect(card).toHaveProperty('value');
      expect(card).toHaveProperty('unit');
    }
  });

  it('safely scopes cross-team visibility by dropping raw issue outliers entirely', async () => {
    const result = await guest.result('get_analytics_overview', {
      range: 'last_30_days',
      measure: 'issues',
    });

    expect(result).not.toHaveProperty('outliers');
    expect(typeof result['outliersWithheld']).toBe('number');
  });
});
