import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../constants/index.ts';
import { idSchema } from './common.ts';

export const INBOX_TABS = ['activity', 'unread', 'mentions', 'pulls', 'status'] as const;
export const inboxCursorSchema = z.object({
  sequence: z.number().int().nonnegative(),
  id: idSchema,
});
export const inboxConversationQuerySchema = z.object({
  tab: z.enum(INBOX_TABS).default('activity'),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const inboxHistoryQuerySchema = inboxConversationQuerySchema.omit({ tab: true });
export const inboxConversationReadSchema = z.object({
  conversationIds: z.array(idSchema).min(1).max(500),
  read: z.boolean(),
});
export const inboxConversationSnoozeSchema = z.object({
  snoozedUntil: z.iso.datetime().nullable(),
});
export const inboxCountersSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  unreadActivityCount: z.number().int().nonnegative(),
  unreadMentionCount: z.number().int().nonnegative(),
});
export const inboxCounterSnapshotSchema = z.object({
  counters: inboxCountersSchema,
  counterVersion: z.number().int().nonnegative(),
});
export const inboxConversationSchema = z.object({
  id: idSchema,
  conversationKey: z.string(),
  subjectType: z.string(),
  subjectId: idSchema,
  category: z.enum(['activity', 'status']),
  latestEventId: idSchema.nullable(),
  type: z.enum(NOTIFICATION_TYPES),
  actorName: z.string(),
  title: z.string(),
  body: z.string(),
  bodyHtml: z.string(),
  url: z.string(),
  externalUrl: z.httpUrl().nullable(),
  occurredAt: z.iso.datetime().nullable(),
  lastActivityAt: z.iso.datetime().nullable(),
  lastActivitySeq: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  unreadEventCount: z.number().int().nonnegative(),
  unreadMentionCount: z.number().int().nonnegative(),
  hasMention: z.boolean(),
  read: z.boolean(),
  snoozedUntil: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable(),
  syncId: z.number().int().nonnegative(),
});
export const inboxConversationPageSchema = inboxCounterSnapshotSchema.extend({
  conversations: z.array(inboxConversationSchema),
  nextCursor: z.string().nullable(),
});
export const inboxConversationMutationSchema = inboxCounterSnapshotSchema.extend({
  conversations: z.array(inboxConversationSchema),
});
export const inboxEventSchema = z.object({
  id: idSchema,
  type: z.enum(NOTIFICATION_TYPES),
  actorName: z.string(),
  title: z.string(),
  body: z.string(),
  bodyHtml: z.string(),
  url: z.string(),
  externalUrl: z.httpUrl().nullable(),
  occurredAt: z.iso.datetime(),
  ingestionSeq: z.number().int().nonnegative(),
});
export const inboxHistoryPageSchema = z.object({
  events: z.array(inboxEventSchema),
  nextCursor: z.string().nullable(),
});
export const inboxConversationDeltaSchema = inboxCounterSnapshotSchema.extend({
  id: idSchema,
  syncId: z.number().int().nonnegative(),
  lastActivitySeq: z.number().int().nonnegative(),
  visible: z.boolean(),
});
export type InboxTab = (typeof INBOX_TABS)[number];
export type InboxConversation = z.infer<typeof inboxConversationSchema>;
export type InboxConversationPage = z.infer<typeof inboxConversationPageSchema>;
export type InboxConversationMutation = z.infer<typeof inboxConversationMutationSchema>;
export type InboxCounterSnapshot = z.infer<typeof inboxCounterSnapshotSchema>;
export type InboxHistoryPage = z.infer<typeof inboxHistoryPageSchema>;
