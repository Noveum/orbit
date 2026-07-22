import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '@orbit/shared';

export interface PreferenceRow {
  readonly userId: string;
  readonly channel: string;
  readonly type: string;
  readonly enabled: boolean;
}

export interface DefaultPreference {
  readonly channel: NotificationChannel;
  readonly type: NotificationType;
  readonly enabled: boolean;
}

export interface NotificationSettings {
  readonly quietHoursEnabled: boolean;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly urgentBypassEnabled: boolean;
  readonly digestEnabled: boolean;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  quietHoursEnabled: true,
  quietHoursStart: '18:00',
  quietHoursEnd: '09:00',
  urgentBypassEnabled: true,
  digestEnabled: true,
};

export function defaultPreferences(): DefaultPreference[] {
  const matrix: DefaultPreference[] = [];
  for (const channel of NOTIFICATION_CHANNELS) {
    for (const type of NOTIFICATION_TYPES) {
      matrix.push({ channel, type, enabled: true });
    }
  }
  return matrix;
}

export function preferenceKey(userId: string, channel: string, type: string): string {
  return `${userId}:${channel}:${type}`;
}

export function disabledPreferenceIndex(rows: readonly PreferenceRow[]): Set<string> {
  const disabled = new Set<string>();
  for (const row of rows) {
    if (!row.enabled) disabled.add(preferenceKey(row.userId, row.channel, row.type));
  }
  return disabled;
}

export function isChannelEnabled(
  disabled: ReadonlySet<string>,
  userId: string,
  channel: NotificationChannel,
  type: NotificationType,
): boolean {
  return !disabled.has(preferenceKey(userId, channel, type));
}
