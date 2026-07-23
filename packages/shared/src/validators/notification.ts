import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../constants/index.ts';
import { idSchema } from './common.ts';

export const notificationPreferenceSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  type: z.enum(NOTIFICATION_TYPES),
  enabled: z.boolean(),
});

export const notificationPreferencesUpdateSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).min(1).max(200),
  quietHoursEnabled: z.boolean().optional(),
  urgentBypassEnabled: z.boolean().optional(),
});

export const notificationReadSchema = z.object({
  notificationIds: z.array(idSchema).min(1).max(500),
  read: z.boolean(),
});
