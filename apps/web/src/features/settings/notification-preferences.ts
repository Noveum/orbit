import { randomUUID } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import type { NotificationSettings } from '@orbit/services/notifications';
import { DEFAULT_SETTINGS } from '@orbit/services/notifications';
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
}

export async function loadNotificationPreferences(
  userId: string,
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

  return {
    disabledKeys: rows.filter((row) => !row.enabled).map((row) => `${row.channel}:${row.type}`),
    settings: setting ?? DEFAULT_SETTINGS,
  };
}

export async function saveNotificationPreferences(
  userId: string,
  input: unknown,
): Promise<NotificationPreferenceState> {
  const parsed = notificationSettingsSchema.parse(input);

  await db.transaction(async (tx) => {
    for (const preference of parsed.preferences) {
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
    };

    await tx
      .insert(schema.notificationSetting)
      .values({ userId, ...settings })
      .onConflictDoUpdate({ target: schema.notificationSetting.userId, set: settings });
  });

  return await loadNotificationPreferences(userId);
}
