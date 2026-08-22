import { randomUUID } from 'node:crypto';
import { and, db, eq, schema } from '@orbit/db';
import type { NotificationSettings } from '@orbit/services/notifications';
import { DEFAULT_SETTINGS } from '@orbit/services/notifications';
import { SLACK_INTEGRATION_ENABLED } from '@orbit/shared/constants';
import { notificationPreferencesUpdateSchema } from '@orbit/shared/validators';
import { z } from 'zod';

export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationSettingsSchema = notificationPreferencesUpdateSchema.extend({
  quietHoursStart: z.string().regex(CLOCK_PATTERN).optional(),
  quietHoursEnd: z.string().regex(CLOCK_PATTERN).optional(),
});

export interface NotificationPreferenceState {
  readonly disabledKeys: string[];
  readonly settings: NotificationSettings;
  readonly slackDm: 'available' | 'unmapped' | 'reauthorize' | 'unavailable';
}

export async function loadNotificationPreferences(
  userId: string,
  organizationId: string,
): Promise<NotificationPreferenceState> {
  const rows = await db
    .select()
    .from(schema.notificationPreference)
    .where(eq(schema.notificationPreference.userId, userId));
  const [setting] = await db
    .select()
    .from(schema.notificationSetting)
    .where(eq(schema.notificationSetting.userId, userId))
    .limit(1);

  const [slack] = await db
    .select({ config: schema.integration.config, integrationId: schema.integration.id })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, 'slack'),
      ),
    )
    .limit(1);
  let slackDm: NotificationPreferenceState['slackDm'] = 'unavailable';
  if (SLACK_INTEGRATION_ENABLED && slack !== undefined) {
    const scopes = slack.config['scopes'];
    if (Array.isArray(scopes) && scopes.includes('im:write') && scopes.includes('chat:write')) {
      const [mapping] = await db
        .select({ id: schema.slackUserMapping.id })
        .from(schema.slackUserMapping)
        .where(
          and(
            eq(schema.slackUserMapping.integrationId, slack.integrationId),
            eq(schema.slackUserMapping.userId, userId),
          ),
        )
        .limit(1);
      slackDm = mapping === undefined ? 'unmapped' : 'available';
    } else slackDm = 'reauthorize';
  }

  return {
    disabledKeys: rows.filter((row) => !row.enabled).map((row) => `${row.channel}:${row.type}`),
    settings: setting ?? DEFAULT_SETTINGS,
    slackDm,
  };
}

export async function saveNotificationPreferences(
  userId: string,
  organizationId: string,
  input: unknown,
): Promise<NotificationPreferenceState> {
  const parsed = notificationSettingsSchema.parse(input);

  const current = await loadNotificationPreferences(userId, organizationId);
  const preferences =
    current.slackDm === 'available'
      ? parsed.preferences
      : parsed.preferences.filter((preference) => preference.channel !== 'slack_dm');

  await db.transaction(async (tx) => {
    for (const preference of preferences) {
      await tx
        .insert(schema.notificationPreference)
        .values({
          id: randomUUID(),
          userId,
          channel: preference.channel,
          type: preference.type,
          enabled: preference.enabled,
        })
        .onConflictDoUpdate({
          target: [
            schema.notificationPreference.userId,
            schema.notificationPreference.channel,
            schema.notificationPreference.type,
          ],
          set: { enabled: preference.enabled },
        });
    }

    const settings = {
      ...(parsed.quietHoursEnabled === undefined
        ? {}
        : { quietHoursEnabled: parsed.quietHoursEnabled }),
      ...(parsed.quietHoursStart === undefined ? {} : { quietHoursStart: parsed.quietHoursStart }),
      ...(parsed.quietHoursEnd === undefined ? {} : { quietHoursEnd: parsed.quietHoursEnd }),
      ...(parsed.urgentBypassEnabled === undefined
        ? {}
        : { urgentBypassEnabled: parsed.urgentBypassEnabled }),
      ...(parsed.digestEnabled === undefined ? {} : { digestEnabled: parsed.digestEnabled }),
    };

    await tx
      .insert(schema.notificationSetting)
      .values({ userId, ...settings })
      .onConflictDoUpdate({ target: schema.notificationSetting.userId, set: settings });
  });

  return await loadNotificationPreferences(userId, organizationId);
}
