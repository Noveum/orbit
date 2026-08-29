import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { SLACK_INTEGRATION_ENABLED } from '@orbit/shared/constants';
import { randomUUIDv7 } from '@orbit/shared/utils';

const slackCapability = await import('@/lib/integrations/slack-capability.ts');
let slackEnabledForTest = true;
const slackCapabilitySpy = spyOn(slackCapability, 'slackIntegrationEnabled').mockImplementation(
  () => slackEnabledForTest,
);
const { loadNotificationPreferences, saveNotificationPreferences } = await import(
  '../../../src/features/settings/notification-preferences.ts'
);

let workspace: Workspace;

async function seedSlackConnection(
  options: {
    readonly config?: Record<string, unknown>;
    readonly credentials?: Record<string, unknown>;
    readonly externalId?: string;
    readonly mapped?: boolean;
    readonly mappingOrganizationId?: string;
  } = {},
): Promise<string> {
  const integrationId = `int_${randomUUIDv7()}`;
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId: workspace.organizationId,
    provider: 'slack',
    externalId: options.externalId ?? 'default',
    connectedById: workspace.admin.userId,
    credentials: options.credentials ?? { botToken: 'xoxb-test' },
    config: options.config ?? { scopes: ['chat:write', 'im:write'] },
  });
  if (options.mapped ?? true) {
    await db.insert(schema.slackUserMapping).values({
      id: `map_${randomUUIDv7()}`,
      organizationId: options.mappingOrganizationId ?? workspace.organizationId,
      integrationId,
      userId: workspace.admin.userId,
      slackUserId: `U${randomUUIDv7()}`,
      slackDisplayName: 'Ada Slack',
    });
  }
  return integrationId;
}

beforeEach(async () => {
  slackEnabledForTest = true;
  await resetDatabase();
  workspace = await createWorkspace('Noveum');
});

afterAll(() => {
  slackCapabilitySpy.mockRestore();
});

describe('notification preferences', () => {
  it('keeps Slack DM disabled while the integration capability is dark', async () => {
    slackEnabledForTest = SLACK_INTEGRATION_ENABLED;
    await seedSlackConnection();
    await db.insert(schema.notificationPreference).values({
      id: randomUUIDv7(),
      userId: workspace.admin.userId,
      channel: 'slack_dm',
      type: 'mention',
      enabled: false,
    });

    const initial = await loadNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
    );
    const saved = await saveNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
      {
        preferences: [{ channel: 'slack_dm', type: 'mention', enabled: false }],
      },
    );

    expect(initial.slackDm).toBe('disabled');
    expect(initial.disabledKeys).not.toContain('slack_dm:mention');
    expect(saved.slackDm).toBe('disabled');
    expect(saved.disabledKeys).not.toContain('slack_dm:mention');
    const rows = await db
      .select({ channel: schema.notificationPreference.channel })
      .from(schema.notificationPreference)
      .where(eq(schema.notificationPreference.userId, workspace.admin.userId));
    expect(rows).toEqual([{ channel: 'slack_dm' }]);
  });

  it('reports an eligible connection without a user mapping and ignores its DM preference', async () => {
    await seedSlackConnection({ mapped: false });

    const saved = await saveNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
      {
        preferences: [
          { channel: 'slack_dm', type: 'mention', enabled: false },
          { channel: 'inbox', type: 'mention', enabled: false },
        ],
      },
    );

    expect(saved.slackDm).toBe('unmapped');
    expect(saved.disabledKeys).not.toContain('slack_dm:mention');
    const rows = await db
      .select({ channel: schema.notificationPreference.channel })
      .from(schema.notificationPreference)
      .where(eq(schema.notificationPreference.userId, workspace.admin.userId));
    expect(rows).toEqual([{ channel: 'inbox' }]);
  });

  it('requires reauthorization when the default Slack connection has no bot token', async () => {
    await seedSlackConnection({ credentials: {} });

    const state = await loadNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
    );

    expect(state.slackDm).toBe('reauthorize');
  });

  it('does not offer Slack DM for a non-default connection', async () => {
    await seedSlackConnection({ externalId: 'workspace-secondary' });

    const state = await loadNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
    );

    expect(state.slackDm).toBe('unavailable');
  });

  it('does not accept a mapping recorded for another organization', async () => {
    const other = await createWorkspace('Elsewhere');
    await seedSlackConnection({ mappingOrganizationId: other.organizationId });

    const state = await loadNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
    );

    expect(state.slackDm).toBe('unmapped');
  });

  it('discards hidden channel preferences from an old client', async () => {
    await saveNotificationPreferences(workspace.admin.userId, workspace.organizationId, {
      preferences: [
        { channel: 'slack', type: 'mention', enabled: false },
        { channel: 'inbox', type: 'mention', enabled: false },
      ],
    });

    const rows = await db
      .select({ channel: schema.notificationPreference.channel })
      .from(schema.notificationPreference)
      .where(eq(schema.notificationPreference.userId, workspace.admin.userId));
    expect(rows).toEqual([{ channel: 'inbox' }]);
  });

  it('does not expose a legacy hidden channel preference', async () => {
    await db.insert(schema.notificationPreference).values({
      id: randomUUIDv7(),
      userId: workspace.admin.userId,
      channel: 'slack',
      type: 'mention',
      enabled: false,
    });

    const state = await loadNotificationPreferences(
      workspace.admin.userId,
      workspace.organizationId,
    );

    expect(state.disabledKeys).not.toContain('slack:mention');
  });
});
