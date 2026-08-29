import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createIssue, createTeam } from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
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

async function completeIssue(
  teamId: string,
  stateId: string,
  title: string,
  estimate: number,
): Promise<void> {
  const created = await createIssue(workspace.admin, { teamId, stateId, title, estimate });
  const completedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startedAt = new Date(completedAt.getTime() - 10 * 24 * 60 * 60 * 1000);
  await db
    .update(schema.issue)
    .set({ createdAt: startedAt, updatedAt: completedAt, startedAt, completedAt })
    .where(eq(schema.issue.id, created.issue.id));
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(await mintToken(workspace.organizationId, guestMember.user.id));
  const [defaultDone] = await db
    .select({ id: schema.workflowState.id })
    .from(schema.workflowState)
    .where(
      and(
        eq(schema.workflowState.teamId, workspace.teamId),
        eq(schema.workflowState.category, 'completed'),
      ),
    )
    .limit(1);
  const operations = await createTeam(workspace.admin, { name: 'Operations', key: 'OPS' });
  const operationsDone = operations.states.find((state) => state.category === 'completed');
  if (defaultDone === undefined || operationsDone === undefined)
    throw new Error('Missing completed workflow state.');
  await completeIssue(workspace.teamId, defaultDone.id, 'Visible completed issue', 3);
  await completeIssue(operations.team.id, operationsDone.id, 'Restricted completed issue', 5);
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

  it('rejects sprint-only ranges that lack a team context', async () => {
    for (const range of ['active_sprint', 'previous_sprint']) {
      const result = await admin.call('get_analytics_overview', { range });

      expect(result.isError).toBe(true);
    }
  });

  it('translates defaults and maps the response shape safely with stable IDs and resolved range', async () => {
    const result = await admin.result('get_analytics_overview', {});

    expect(result).toHaveProperty('asOf');
    expect(result['resolvedRange']).toEqual({
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      timezone: 'UTC',
    });
    expect(result['comparisonRange']).toBeNull();
    expect(result['outliersWithheldCount']).toBe(0);
    expect(result).not.toHaveProperty('outliers');

    const metrics = result['metrics'] as Record<string, unknown>[];
    const throughput = metrics.find((metric) => metric['id'] === 'throughput');

    expect(throughput).toMatchObject({
      id: 'throughput',
      metric: 'Completed in range',
      value: 0,
      unit: 'issues',
      comparisonDelta: null,
    });
    expect(metrics.map((metric) => metric['id'])).toEqual([
      'throughput',
      'wip',
      'cycle_time_p50',
      'cycle_time_p85',
      'blocked',
      'overdue',
      'stale',
      'unestimated',
    ]);

    for (const card of metrics) {
      expect(card).toHaveProperty('id');
      expect(card).toHaveProperty('metric');
      expect(card).toHaveProperty('value');
      expect(card).toHaveProperty('unit');
      expect(card).toHaveProperty('comparisonDelta');
    }
  });

  it('maps explicit range and measure inputs to effective analytics semantics', async () => {
    const result = await admin.result('get_analytics_overview', {
      range: 'last_90_days',
      measure: 'points',
    });
    const resolved = result['resolvedRange'] as { from: string; to: string };
    const comparison = result['comparisonRange'] as {
      from: string;
      to: string;
      timezone: string;
    };
    const duration = Date.parse(resolved.to) - Date.parse(resolved.from);
    const comparisonDuration = Date.parse(comparison.to) - Date.parse(comparison.from);
    const metrics = result['metrics'] as Record<string, unknown>[];

    expect(duration).toBe(90 * 24 * 60 * 60 * 1000);
    expect(comparisonDuration).toBe(duration);
    expect(comparison.to).toBe(resolved.from);
    expect(comparison.timezone).toBe('UTC');
    expect(result['outliersWithheldCount']).toBe(2);
    expect(metrics.find((metric) => metric['id'] === 'throughput')).toMatchObject({
      value: 8,
      unit: 'points',
      comparisonDelta: 8,
    });
  });

  it('safely drops all raw issue outliers and reports how many were omitted', async () => {
    const result = await guest.result('get_analytics_overview', {
      range: 'last_30_days',
      measure: 'issues',
    });

    expect(result).not.toHaveProperty('outliers');
    expect(result['outliersWithheldCount']).toBe(2);
  });
});
