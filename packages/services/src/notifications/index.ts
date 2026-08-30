import type { Database, Transaction } from '@orbit/db';
import {
  integration,
  nextSyncId,
  notification,
  notificationDelivery,
  notificationPreference,
  notificationSetting,
  slackUserMapping,
  user,
} from '@orbit/db/schema';
import {
  actorSchema,
  idSchema,
  isStatusChangeNotification,
  NOTIFICATION_AUDIENCE_BY_REASON,
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
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
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
export const SLACK_DM_MAX_ATTEMPTS = 5;
const SLACK_DM_RETRY_BASE_MS = 30_000;
const SLACK_DM_RETRY_MAX_MS = 60 * 60_000;

export interface SlackDmFailureOptions {
  readonly currentAttempts?: number;
  readonly now?: Date;
  readonly permanent?: boolean;
  readonly retryAfterMs?: number;
}

export async function markNotificationDelivered(
  database: NotificationDatabase,
  notificationId: string,
  channel: string,
): Promise<void> {
  await database
    .update(notification)
    .set({
      deliveredChannels: sql`(
        SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
        FROM (
          SELECT value
          FROM jsonb_array_elements_text(${notification.deliveredChannels} || ${JSON.stringify([channel])}::jsonb)
          GROUP BY value
          ORDER BY MIN(value)
        ) values
      )`,
    })
    .where(eq(notification.id, notificationId));
}

export async function markSlackDmDelivery(
  database: NotificationDatabase,
  deliveryId: string,
  claimedAt: Date,
  delivered: boolean,
  error?: string,
  providerMessage?: { channel: string | null; ts: string | null },
  failure: SlackDmFailureOptions = {},
): Promise<boolean> {
  const now = failure.now ?? new Date();
  const nextAttempts = (failure.currentAttempts ?? 0) + 1;
  const exponentialBackoff = Math.min(
    SLACK_DM_RETRY_BASE_MS * 2 ** Math.max(0, nextAttempts - 1),
    SLACK_DM_RETRY_MAX_MS,
  );
  const providerBackoff =
    failure.retryAfterMs !== undefined &&
    Number.isFinite(failure.retryAfterMs) &&
    failure.retryAfterMs >= 0
      ? failure.retryAfterMs
      : 0;
  const retryAt = new Date(now.getTime() + Math.max(exponentialBackoff, providerBackoff));
  const deadLettered = failure.permanent === true || nextAttempts >= SLACK_DM_MAX_ATTEMPTS;
  const failedStatus = deadLettered ? 'dead_letter' : 'failed';
  const updated = await database
    .update(notificationDelivery)
    .set({
      status: delivered ? 'succeeded' : failedStatus,
      attempts: sql`${notificationDelivery.attempts} + 1`,
      ...(delivered
        ? {
            deliveredAt: now,
            lastError: null,
            providerMessageChannel: providerMessage?.channel ?? null,
            providerMessageTs: providerMessage?.ts ?? null,
          }
        : {
            lastError: error ?? 'delivery failed',
            ...(deadLettered ? {} : { availableAt: retryAt }),
          }),
    })
    .where(
      and(
        eq(notificationDelivery.id, deliveryId),
        eq(notificationDelivery.channel, 'slack_dm'),
        eq(notificationDelivery.status, 'processing'),
        eq(notificationDelivery.claimedAt, claimedAt),
      ),
    )
    .returning({ id: notificationDelivery.id });
  return updated.length > 0;
}

export async function markSlackDmUnavailable(
  database: NotificationDatabase,
  deliveryId: string,
  claimedAt: Date,
  error = 'Slack user mapping unavailable',
  attempted = false,
): Promise<boolean> {
  const updated = await database
    .update(notificationDelivery)
    .set({
      status: 'skipped',
      lastError: error,
      ...(attempted ? { attempts: sql`${notificationDelivery.attempts} + 1` } : {}),
    })
    .where(
      and(
        eq(notificationDelivery.id, deliveryId),
        eq(notificationDelivery.channel, 'slack_dm'),
        eq(notificationDelivery.status, 'processing'),
        eq(notificationDelivery.claimedAt, claimedAt),
      ),
    )
    .returning({ id: notificationDelivery.id });
  return updated.length > 0;
}

export async function markSlackReauthorizationRequired(
  database: NotificationDatabase,
  organizationId: string,
  integrationId?: string,
  expectedBotToken?: string,
  expectedIntegrationVersion?: string,
): Promise<boolean> {
  const updated = await database
    .update(integration)
    .set({
      config: sql`jsonb_set(${integration.config}, '{slackReauthorize}', 'true'::jsonb)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integration.organizationId, organizationId),
        eq(integration.provider, 'slack'),
        ...(integrationId === undefined ? [] : [eq(integration.id, integrationId)]),
        ...(expectedBotToken === undefined
          ? []
          : [sql`${integration.credentials}->>'botToken' = ${expectedBotToken}`]),
        ...(expectedIntegrationVersion === undefined
          ? []
          : [
              sql`extract(epoch from ${integration.updatedAt})::text = ${expectedIntegrationVersion}`,
            ]),
      ),
    )
    .returning({ id: integration.id });
  return updated.length > 0;
}

export async function claimSlackDmDeliveries(
  database: NotificationDatabase,
  limit = 100,
  now = new Date(),
  atomic = false,
  organizationId?: string,
): Promise<(typeof notificationDelivery.$inferSelect)[]> {
  if (atomic && 'transaction' in database) {
    return await database.transaction((tx) =>
      claimSlackDmDeliveries(tx, limit, now, false, organizationId),
    );
  }
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const organizationFilter =
    organizationId === undefined
      ? sql``
      : sql`AND ${notification.organizationId} = ${organizationId}`;
  return await database
    .update(notificationDelivery)
    .set({ status: 'processing', claimedAt: now })
    .where(
      sql`${notificationDelivery.id} IN (
        SELECT ${notificationDelivery.id}
        FROM ${notificationDelivery}
        INNER JOIN ${notification}
          ON ${notification.id} = ${notificationDelivery.notificationId}
        WHERE ${notificationDelivery.channel} = 'slack_dm'
          AND ${notificationDelivery.availableAt} <= ${now.toISOString()}
          ${organizationFilter}
          AND (
            ${notificationDelivery.status} IN ('pending', 'failed')
            OR (
              ${notificationDelivery.status} = 'processing'
              AND ${notificationDelivery.claimedAt} < ${staleBefore.toISOString()}
            )
          )
        ORDER BY
          CASE WHEN ${notificationDelivery.status} = 'processing' THEN 1 ELSE 0 END,
          ${notificationDelivery.attempts},
          ${notificationDelivery.availableAt},
          ${notificationDelivery.createdAt}
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning();
}

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

export interface SlackDmDispatch {
  readonly userId: string;
  readonly notificationId: string;
  readonly sendAt: Date;
}

export interface NotifyOutcome {
  readonly notifications: NotificationRecord[];
  readonly actions: SyncAction[];
  readonly email: EmailDispatch[];
  readonly slack: SlackDispatch[];
  readonly slackDm: SlackDmDispatch[];
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
  readonly slackDmAt: Date | null;
}

const slackDmEligibilitySchema = z.object({
  credentials: z.object({ botToken: z.string().min(1) }),
  config: z.object({
    scopes: z.array(z.string()),
    slackReauthorize: z.boolean().optional(),
  }),
});

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: notification planning coordinates dedupe, preferences, persistence, and delivery scheduling
export async function notifyMany(
  database: NotificationDatabase,
  events: readonly NotificationEvent[],
  options: {
    readonly now?: Date;
    readonly slackEnabled?: boolean;
    readonly sourceDeliveryId?: string;
  } = {},
): Promise<NotifyOutcome> {
  const parsed = events.map((event) => notificationEventSchema.parse(event));
  const now = options.now ?? new Date();
  const slackFeatureEnabled = resolveSlackFeatureEnabled(options.slackEnabled);
  const recipientIds = unique(
    parsed.flatMap((event) => event.userIds.filter((id) => id !== event.actor.id)),
  );
  if (recipientIds.length === 0) return emptyOutcome();

  const recipients = await loadRecipients(database, recipientIds);
  const settings = await loadSettings(database, recipientIds);
  const slackDmEligibleRecipients = slackFeatureEnabled
    ? await loadSlackDmEligibleRecipients(database, parsed, recipientIds)
    : new Map<string, ReadonlySet<string>>();
  const disabled = disabledPreferenceIndex(
    await database
      .select({
        userId: notificationPreference.userId,
        channel: notificationPreference.channel,
        type: notificationPreference.type,
        enabled: notificationPreference.enabled,
      })
      .from(notificationPreference)
      .where(
        and(
          inArray(notificationPreference.userId, recipientIds),
          ne(notificationPreference.channel, 'slack'),
        ),
      ),
  );
  const seen = await loadRecentKeys(database, recipientIds, now);
  const sourceDeliveryKeys =
    options.sourceDeliveryId === undefined
      ? new Set<string>()
      : new Set(
          (
            await database
              .select({ userId: notificationDelivery.userId })
              .from(notificationDelivery)
              .where(
                and(
                  eq(notificationDelivery.sourceDeliveryId, options.sourceDeliveryId),
                  eq(notificationDelivery.channel, 'slack_dm'),
                  inArray(notificationDelivery.userId, recipientIds),
                ),
              )
          ).map((row) => row.userId),
        );

  const plans: Plan[] = [];
  let deduped = 0;
  for (const event of parsed) {
    for (const userId of event.userIds) {
      const recipient = recipients.get(userId);
      if (userId === event.actor.id || recipient === undefined) continue;
      if (sourceDeliveryKeys.has(userId)) {
        deduped += 1;
        continue;
      }
      const key = dedupeKey(userId, event.type, event.entityId, event.externalUrl ?? null);
      if (seen.has(key)) {
        deduped += 1;
        continue;
      }
      const plan = planFor(
        event,
        recipient,
        settings.get(userId) ?? DEFAULT_SETTINGS,
        disabled,
        now,
        slackFeatureEnabled,
        slackDmEligibleRecipients.get(event.organizationId)?.has(userId) === true,
      );
      if (plan !== null) {
        seen.add(key);
        plans.push(plan);
      }
    }
  }
  if (plans.length === 0) return { ...emptyOutcome(), deduped };

  const rows = await database
    .insert(notification)
    .values(plans.map((plan) => toInsert(plan, now)))
    .returning();

  const deliveryRows = slackDeliveryRows(rows, plans, now, options.sourceDeliveryId);
  if (deliveryRows.length > 0) await database.insert(notificationDelivery).values(deliveryRows);

  return buildOutcome(plans, rows, deduped);
}

function slackDeliveryRows(
  rows: readonly NotificationRecord[],
  plans: readonly Plan[],
  now: Date,
  sourceDeliveryId?: string,
) {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  return rows.flatMap((row) => {
    const plan = planById.get(row.id);
    if (plan === undefined || !plan.channels.includes('slack_dm')) return [];
    return [
      {
        id: randomUUIDv7(now),
        notificationId: row.id,
        sourceDeliveryId: sourceDeliveryId ?? null,
        userId: row.userId,
        channel: 'slack_dm',
        availableAt: plan.slackDmAt ?? now,
      },
    ];
  });
}

function resolveSlackFeatureEnabled(value: boolean | undefined): boolean {
  return value ?? SLACK_INTEGRATION_ENABLED;
}

function planFor(
  event: ParsedEvent,
  recipient: Recipient,
  settings: NotificationSettings,
  disabled: ReadonlySet<string>,
  now: Date,
  slackFeatureEnabled: boolean,
  slackDmEligible: boolean,
): Plan | null {
  const inboxEnabled = isChannelEnabled(disabled, recipient.id, 'inbox', event.type);
  const emailEnabled = isChannelEnabled(disabled, recipient.id, 'email', event.type);
  const personal = isPersonalNotification(event);
  const slackEnabled =
    slackFeatureEnabled &&
    !personal &&
    isChannelEnabled(disabled, recipient.id, 'slack', event.type);
  const slackDmEnabled =
    slackFeatureEnabled &&
    personal &&
    slackDmEligible &&
    isChannelEnabled(disabled, recipient.id, 'slack_dm', event.type);
  if (!(inboxEnabled || emailEnabled || slackEnabled || slackDmEnabled)) return null;
  const quietHours: QuietHours = {
    enabled: settings.quietHoursEnabled,
    start: settings.quietHoursStart,
    end: settings.quietHoursEnd,
    timeZone: recipient.timezone,
  };
  const bypass = isUrgent(event) && settings.urgentBypassEnabled;
  const deferred =
    (emailEnabled || slackDmEnabled) && !bypass && isWithinQuietHours(now, quietHours);
  return {
    id: randomUUIDv7(now),
    event,
    recipient,
    channels: [
      ...(inboxEnabled ? [INBOX_CHANNEL] : []),
      ...(emailEnabled ? ['email'] : []),
      ...(slackEnabled ? ['slack'] : []),
      ...(slackDmEnabled ? ['slack_dm'] : []),
    ],
    emailAt: emailSendAt(emailEnabled, deferred, now, quietHours),
    emailDeferred: deferred,
    slackDmAt: slackDmSendAt(slackDmEnabled, deferred, now, quietHours),
  };
}

async function loadSlackDmEligibleRecipients(
  database: NotificationDatabase,
  events: readonly ParsedEvent[],
  recipientIds: readonly string[],
): Promise<Map<string, ReadonlySet<string>>> {
  const organizationIds = unique(
    events.filter(isPersonalNotification).map((event) => event.organizationId),
  );
  if (organizationIds.length === 0) return new Map();
  const rows = await database
    .select({
      organizationId: integration.organizationId,
      userId: slackUserMapping.userId,
      credentials: integration.credentials,
      config: integration.config,
    })
    .from(integration)
    .innerJoin(
      slackUserMapping,
      and(
        eq(slackUserMapping.integrationId, integration.id),
        eq(slackUserMapping.organizationId, integration.organizationId),
      ),
    )
    .where(
      and(
        inArray(integration.organizationId, organizationIds),
        eq(integration.provider, 'slack'),
        eq(integration.externalId, 'default'),
        inArray(slackUserMapping.userId, [...recipientIds]),
      ),
    );
  const eligible = new Map<string, Set<string>>();
  for (const row of rows) {
    const parsed = slackDmEligibilitySchema.safeParse(row);
    if (!parsed.success) continue;
    if (parsed.data.config.slackReauthorize === true) continue;
    const scopes = parsed.data.config.scopes;
    if (!(scopes.includes('chat:write') && scopes.includes('im:write'))) continue;
    const recipients = eligible.get(row.organizationId) ?? new Set<string>();
    recipients.add(row.userId);
    eligible.set(row.organizationId, recipients);
  }
  return eligible;
}

function slackDmSendAt(
  enabled: boolean,
  deferred: boolean,
  now: Date,
  quietHours: QuietHours,
): Date | null {
  if (!enabled) return null;
  return deferred ? nextQuietHoursEnd(now, quietHours) : now;
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

function isPersonalNotification(event: ParsedEvent): boolean {
  return NOTIFICATION_AUDIENCE_BY_REASON[event.reason] === 'personal';
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
    deliveredChannels: plan.channels.filter((channel) => channel !== 'slack_dm'),
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
  const slackDm: SlackDmDispatch[] = [];
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
    if (plan.channels.includes('slack_dm') && plan.slackDmAt !== null) {
      slackDm.push({ userId: row.userId, notificationId: row.id, sendAt: plan.slackDmAt });
    }
  }
  return { notifications: rows, actions, email, slack, slackDm, deduped };
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
  return { notifications: [], actions: [], email: [], slack: [], slackDm: [], deduped: 0 };
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
