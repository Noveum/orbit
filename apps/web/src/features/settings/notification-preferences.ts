import { and, db, eq, schema } from '@orbit/db';
import type { NotificationSettings } from '@orbit/services/notifications';
import { DEFAULT_SETTINGS } from '@orbit/services/notifications';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { notificationPreferencesUpdateSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { slackIntegrationEnabledForOrganization } from '@/lib/integrations/slack-capability.ts';

export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationSettingsSchema = notificationPreferencesUpdateSchema.extend({
  quietHoursStart: z.string().regex(CLOCK_PATTERN).optional(),
  quietHoursEnd: z.string().regex(CLOCK_PATTERN).optional(),
});

const slackDmConnectionSchema = z.object({
  credentials: z.object({ botToken: z.string().min(1) }),
  config: z.object({
    scopes: z.array(z.string()),
    slackReauthorize: z.boolean().optional(),
  }),
});

export interface NotificationPreferenceState {
  readonly disabledKeys: string[];
  readonly settings: NotificationSettings;
  readonly slackDm: 'available' | 'disabled' | 'unmapped' | 'reauthorize' | 'unavailable';
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

  const slackEnabled = slackIntegrationEnabledForOrganization(organizationId);
  const [slack] = slackEnabled
    ? await db
        .select({
          config: schema.integration.config,
          credentials: schema.integration.credentials,
          integrationId: schema.integration.id,
        })
        .from(schema.integration)
        .where(
          and(
            eq(schema.integration.organizationId, organizationId),
            eq(schema.integration.provider, 'slack'),
            eq(schema.integration.externalId, 'default'),
          ),
        )
        .limit(1)
    : [];
  let slackDm: NotificationPreferenceState['slackDm'] = slackEnabled ? 'unavailable' : 'disabled';
  if (slack !== undefined) {
    const parsedSlack = slackDmConnectionSchema.safeParse(slack);
    if (
      !parsedSlack.success ||
      parsedSlack.data.config.slackReauthorize === true ||
      !parsedSlack.data.config.scopes.includes('im:write') ||
      !parsedSlack.data.config.scopes.includes('chat:write')
    ) {
      slackDm = 'reauthorize';
    } else {
      const [mapping] = await db
        .select({ id: schema.slackUserMapping.id })
        .from(schema.slackUserMapping)
        .where(
          and(
            eq(schema.slackUserMapping.integrationId, slack.integrationId),
            eq(schema.slackUserMapping.organizationId, organizationId),
            eq(schema.slackUserMapping.userId, userId),
          ),
        )
        .limit(1);
      slackDm = mapping === undefined ? 'unmapped' : 'available';
    }
  }

  return {
    disabledKeys: rows
      .filter(
        (row) =>
          row.channel !== 'slack' && (slackEnabled || row.channel !== 'slack_dm') && !row.enabled,
      )
      .map((row) => `${row.channel}:${row.type}`),
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
  const preferences = parsed.preferences.filter(
    (preference) =>
      preference.channel !== 'slack' &&
      (preference.channel !== 'slack_dm' || current.slackDm === 'available'),
  );

  await db.transaction(async (tx) => {
    for (const preference of preferences) {
      await tx
        .insert(schema.notificationPreference)
        .values({
          id: randomUUIDv7(),
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

    if (Object.keys(settings).length > 0) {
      await tx
        .insert(schema.notificationSetting)
        .values({ userId, ...settings })
        .onConflictDoUpdate({ target: schema.notificationSetting.userId, set: settings });
    }
  });

  return await loadNotificationPreferences(userId, organizationId);
}
