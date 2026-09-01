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
  digestEnabled: z.boolean().optional(),
});

export const notificationReadSchema = z.object({
  notificationIds: z.array(idSchema).min(1).max(500),
  read: z.boolean(),
});

export const notificationSourceInputSchema = z.object({
  sourceEventKey: z.string().trim().min(1).max(512),
  subjectType: z.string().trim().min(1).max(64),
  subjectKey: z.string().trim().min(1).max(512),
  occurredAt: z.coerce.date(),
  teamIds: z.array(idSchema).max(100).default([]),
  payload: z.record(z.string(), z.unknown()),
});

export type NotificationSourceInput = z.input<typeof notificationSourceInputSchema>;
