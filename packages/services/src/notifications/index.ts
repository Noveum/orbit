import type { Database, Transaction } from '@orbit/db';
import {
  nextSyncId,
  notification,
  notificationPreference,
  notificationSetting,
  user,
} from '@orbit/db/schema';
import {
  actorSchema,
  idSchema,
  isStatusChangeNotification,
  NOTIFICATION_REASONS,
  NOTIFICATION_TYPES,
  SLACK_INTEGRATION_ENABLED,
  type SyncAction,
  scopes,
  syncActionSchema,
  unique,
  validationFailed,
} from '@orbit/shared';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { renderMarkdown } from '../markdown/index.ts';
import {
  DEFAULT_SETTINGS,
  disabledPreferenceIndex,
  isChannelEnabled,
  type NotificationSettings,
} from './preferences.ts';
import { isWithinQuietHours, nextQuietHoursEnd, type QuietHours } from './quiet-hours.ts';

export * from './preferences.ts';
export * from './quiet-hours.ts';

export type NotificationDatabase = Database | Transaction;
export type NotificationRecord = typeof notification.$inferSelect;

export const DEDUPE_WINDOW_MS = 60_000;
export const INBOX_CHANNEL = 'inbox';

function deliveredToInbox() {
  return sql`${notification.deliveredChannels} @> '["inbox"]'::jsonb`;
}

export const notificationEventSchema = z.object({
  organizationId: idSchema,
  type: z.enum(NOTIFICATION_TYPES),
  reason: z.enum(NOTIFICATION_REASONS),
  actor: actorSchema,
  entityType: z.string().trim().min(1).max(32),
  entityId: idSchema,
  userIds: z.array(idSchema).max(500),
  title: z.string().trim().min(1).max(255),
  body: z.string().max(4000).default(''),
  url: z.string().trim().min(1).max(2048),
  externalUrl: z.httpUrl().max(2048).nullish(),
  priority: z.number().int().min(0).max(4).optional(),
});

export type NotificationEvent = z.input<typeof notificationEventSchema>;
type ParsedEvent = z.output<typeof notificationEventSchema>;

export interface EmailDispatch {
  readonly userId: string;
  readonly email: string;
  readonly notificationId: string;
  readonly sendAt: Date;
  readonly deferred: boolean;
}

export interface SlackDispatch {
  readonly userId: string;
  readonly notificationId: string;
}

export interface NotifyOutcome {
  readonly notifications: NotificationRecord[];
  readonly actions: SyncAction[];
  readonly email: EmailDispatch[];
  readonly slack: SlackDispatch[];
  readonly deduped: number;
}

interface Recipient {
  readonly id: string;
  readonly email: string;
  readonly timezone: string;
}

interface Plan {
  readonly id: string;
  readonly event: ParsedEvent;
  readonly recipient: Recipient;
  readonly channels: string[];
  readonly emailAt: Date | null;
  readonly emailDeferred: boolean;
}

export async function notifyMany(
  database: NotificationDatabase,
  events: readonly NotificationEvent[],
  options: { readonly now?: Date } = {},
): Promise<NotifyOutcome> {
  const parsed = events.map((event) => notificationEventSchema.parse(event));
  const now = options.now ?? new Date();
  const recipientIds = unique(
    parsed.flatMap((event) => event.userIds.filter((id) => id !== event.actor.id)),
  );
  if (recipientIds.length === 0) return emptyOutcome();

  const recipients = await loadRecipients(database, recipientIds);
  const settings = await loadSettings(database, recipientIds);
  const disabled = disabledPreferenceIndex(
    await database
      .select({
        userId: notificationPreference.userId,
        channel: notificationPreference.channel,
        type: notificationPreference.type,
        enabled: notificationPreference.enabled,
      })
      .from(notificationPreference)
      .where(inArray(notificationPreference.userId, recipientIds)),
  );
  const seen = await loadRecentKeys(database, recipientIds, now);

  const plans: Plan[] = [];
  let deduped = 0;
  for (const event of parsed) {
    for (const userId of event.userIds) {
      const recipient = recipients.get(userId);
      if (userId === event.actor.id || recipient === undefined) continue;
      const key = dedupeKey(userId, event.type, event.entityId, event.externalUrl ?? null);
      if (seen.has(key)) {
        deduped += 1;
        continue;
      }
      seen.add(key);
      const plan = planFor(
        event,
        recipient,
        settings.get(userId) ?? DEFAULT_SETTINGS,
        disabled,
        now,
      );
      if (plan !== null) plans.push(plan);
    }
  }
  if (plans.length === 0) return { ...emptyOutcome(), deduped };

  const rows = await database
    .insert(notification)
    .values(plans.map((plan) => toInsert(plan, now)))
    .returning();

  return buildOutcome(plans, rows, deduped);
}

function planFor(
  event: ParsedEvent,
  recipient: Recipient,
  settings: NotificationSettings,
  disabled: ReadonlySet<string>,
  now: Date,
): Plan | null {
  const inboxEnabled = isChannelEnabled(disabled, recipient.id, 'inbox', event.type);
  const emailEnabled = isChannelEnabled(disabled, recipient.id, 'email', event.type);
  const slackEnabled =
    SLACK_INTEGRATION_ENABLED && isChannelEnabled(disabled, recipient.id, 'slack', event.type);
  if (!(inboxEnabled || emailEnabled || slackEnabled)) return null;
  const quietHours: QuietHours = {
    enabled: settings.quietHoursEnabled,
    start: settings.quietHoursStart,
    end: settings.quietHoursEnd,
    timeZone: recipient.timezone,
  };
  const bypass = isUrgent(event) && settings.urgentBypassEnabled;
  const deferred = emailEnabled && !bypass && isWithinQuietHours(now, quietHours);
  return {
    id: randomUUIDv7(now),
    event,
    recipient,
    channels: [
      ...(inboxEnabled ? [INBOX_CHANNEL] : []),
      ...(emailEnabled ? ['email'] : []),
      ...(slackEnabled ? ['slack'] : []),
    ],
    emailAt: emailSendAt(emailEnabled, deferred, now, quietHours),
    emailDeferred: deferred,
  };
}

function emailSendAt(
  enabled: boolean,
  deferred: boolean,
  now: Date,
  quietHours: QuietHours,
): Date | null {
  if (!enabled) return null;
  if (!deferred) return now;
  return nextQuietHoursEnd(now, quietHours);
}

function isUrgent(event: ParsedEvent): boolean {
  return event.type === 'issue_assigned' && event.priority === 1;
}

function toInsert(plan: Plan, now: Date) {
  const { event } = plan;
  return {
    id: plan.id,
    organizationId: event.organizationId,
    userId: plan.recipient.id,
    type: event.type,
    reason: event.reason,
    actorType: event.actor.type,
    actorId: event.actor.id,
    actorName: event.actor.name ?? 'Orbit',
    entityType: event.entityType,
    entityId: event.entityId,
    title: event.title,
    body: event.body,
    url: event.url,
    externalUrl: event.externalUrl ?? null,
    deliveredChannels: plan.channels,
    syncId: nextSyncId,
    createdAt: now,
  };
}

function buildOutcome(
  plans: readonly Plan[],
  rows: NotificationRecord[],
  deduped: number,
): NotifyOutcome {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const actions: SyncAction[] = [];
  const email: EmailDispatch[] = [];
  const slack: SlackDispatch[] = [];
  for (const row of rows) {
    const plan = planById.get(row.id);
    if (plan === undefined) continue;
    if (plan.channels.includes(INBOX_CHANNEL)) actions.push(toSyncAction(row, plan));
    if (plan.emailAt !== null) {
      email.push({
        userId: row.userId,
        email: plan.recipient.email,
        notificationId: row.id,
        sendAt: plan.emailAt,
        deferred: plan.emailDeferred,
      });
    }
    if (plan.channels.includes('slack')) {
      slack.push({ userId: row.userId, notificationId: row.id });
    }
  }
  return { notifications: rows, actions, email, slack, deduped };
}

function toSyncAction(row: NotificationRecord, plan: Plan): SyncAction {
  return syncActionSchema.parse({
    syncId: row.syncId,
    organizationId: row.organizationId,
    scopes: [scopes.user(row.userId)],
    action: 'insert',
    model: 'notification',
    modelId: row.id,
    data: {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      type: row.type,
      reason: row.reason,
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: row.actorName,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      body: row.body,
      bodyHtml: renderMarkdown(row.body),
      url: row.url,
      externalUrl: row.externalUrl,
      readAt: row.readAt?.toISOString() ?? null,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      deliveredChannels: row.deliveredChannels,
      syncId: row.syncId,
      createdAt: row.createdAt.toISOString(),
    },
    actor: plan.event.actor,
    at: row.createdAt.toISOString(),
  });
}

async function loadRecipients(
  database: NotificationDatabase,
  userIds: readonly string[],
): Promise<Map<string, Recipient>> {
  const rows = await database
    .select({ id: user.id, email: user.email, timezone: user.timezone })
    .from(user)
    .where(inArray(user.id, [...userIds]));
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadSettings(
  database: NotificationDatabase,
  userIds: readonly string[],
): Promise<Map<string, NotificationSettings>> {
  const rows = await database
    .select()
    .from(notificationSetting)
    .where(inArray(notificationSetting.userId, [...userIds]));
  return new Map(rows.map((row) => [row.userId, row]));
}

async function loadRecentKeys(
  database: NotificationDatabase,
  userIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  const rows = await database
    .select({
      userId: notification.userId,
      type: notification.type,
      entityId: notification.entityId,
      externalUrl: notification.externalUrl,
    })
    .from(notification)
    .where(
      and(
        inArray(notification.userId, [...userIds]),
        gte(notification.createdAt, new Date(now.getTime() - DEDUPE_WINDOW_MS)),
      ),
    );
  return new Set(rows.map((row) => dedupeKey(row.userId, row.type, row.entityId, row.externalUrl)));
}

function dedupeKey(
  userId: string,
  type: string,
  entityId: string,
  externalUrl: string | null,
): string {
  return `${userId}:${type}:${entityId}:${externalUrl ?? ''}`;
}

function emptyOutcome(): NotifyOutcome {
  return { notifications: [], actions: [], email: [], slack: [], deduped: 0 };
}

export const markReadSchema = z.object({
  userId: idSchema,
  organizationId: idSchema,
  notificationIds: z.array(idSchema).min(1).max(500),
  read: z.boolean().default(true),
});

export async function markRead(
  database: NotificationDatabase,
  input: z.input<typeof markReadSchema>,
): Promise<NotificationRecord[]> {
  const params = markReadSchema.parse(input);
  return await database
    .update(notification)
    .set({ readAt: params.read ? new Date() : null, syncId: nextSyncId })
    .where(
      and(
        eq(notification.userId, params.userId),
        eq(notification.organizationId, params.organizationId),
        inArray(notification.id, params.notificationIds),
      ),
    )
    .returning();
}

export const markAllReadSchema = z.object({
  userId: idSchema,
  organizationId: idSchema,
});

export async function markAllRead(
  database: NotificationDatabase,
  input: z.input<typeof markAllReadSchema>,
): Promise<number> {
  const params = markAllReadSchema.parse(input);
  const updated = await database
    .update(notification)
    .set({ readAt: new Date(), syncId: nextSyncId })
    .where(
      and(
        eq(notification.userId, params.userId),
        eq(notification.organizationId, params.organizationId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return updated.length;
}

export const snoozeSchema = z.object({
  userId: idSchema,
  organizationId: idSchema,
  notificationId: idSchema,
  until: z.coerce.date(),
});

export async function snooze(
  database: NotificationDatabase,
  input: z.input<typeof snoozeSchema>,
): Promise<NotificationRecord> {
  const params = snoozeSchema.parse(input);
  const updated = await database
    .update(notification)
    .set({ snoozedUntil: params.until, syncId: nextSyncId })
    .where(
      and(
        eq(notification.userId, params.userId),
        eq(notification.organizationId, params.organizationId),
        eq(notification.id, params.notificationId),
      ),
    )
    .returning();
  const row = updated[0];
  if (row === undefined) throw validationFailed('That notification does not exist.');
  return row;
}

export const listInboxSchema = z.object({
  userId: idSchema,
  organizationId: idSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(64).optional(),
  unreadOnly: z.boolean().default(false),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

export interface InboxPage {
  readonly items: NotificationRecord[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
}

export async function listInbox(
  database: NotificationDatabase,
  input: z.input<typeof listInboxSchema>,
): Promise<InboxPage> {
  const params = listInboxSchema.parse(input);
  const filters = [
    eq(notification.userId, params.userId),
    eq(notification.organizationId, params.organizationId),
    deliveredToInbox(),
  ];
  if (params.cursor !== undefined) filters.push(lt(notification.id, params.cursor));
  if (params.unreadOnly) filters.push(isNull(notification.readAt));
  if (params.type !== undefined) filters.push(eq(notification.type, params.type));

  const rows = await database
    .select()
    .from(notification)
    .where(and(...filters))
    .orderBy(desc(notification.id))
    .limit(params.limit + 1);

  const items = rows.slice(0, params.limit);
  return {
    items,
    nextCursor: rows.length > params.limit ? (items.at(-1)?.id ?? null) : null,
    unreadCount: await unreadCount(database, params.userId, params.organizationId),
  };
}

export async function unreadCount(
  database: NotificationDatabase,
  userId: string,
  organizationId: string,
  at: Date = new Date(),
): Promise<number> {
  const rows = await database
    .select({ value: count() })
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.organizationId, organizationId),
        isNull(notification.readAt),
        deliveredToInbox(),
        or(isNull(notification.snoozedUntil), lte(notification.snoozedUntil, at)),
      ),
    );
  return rows[0]?.value ?? 0;
}

export interface UnreadCounters {
  readonly total: number;
  readonly mentions: number;
  readonly activity: number;
}

export async function unreadCounters(
  database: NotificationDatabase,
  userId: string,
  organizationId: string,
  at: Date = new Date(),
): Promise<UnreadCounters> {
  const rows = await database
    .select({ type: notification.type, value: count() })
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.organizationId, organizationId),
        isNull(notification.readAt),
        deliveredToInbox(),
        or(isNull(notification.snoozedUntil), lte(notification.snoozedUntil, at)),
      ),
    )
    .groupBy(notification.type);
  let total = 0;
  let mentions = 0;
  let activity = 0;
  for (const row of rows) {
    total += row.value;
    if (row.type === 'mention') mentions += row.value;
    if (!isStatusChangeNotification(row.type)) activity += row.value;
  }
  return { total, mentions, activity };
}
