import type { Database, Transaction } from '@orbit/db';
import {
  integration,
  nextSyncId,
  notification,
  notificationDelivery,
  notificationPreference,
  notificationSetting,
  notificationSourceEvent,
  slackChannelSync,
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
  notificationSourceInputSchema,
  type SyncAction,
  scopes,
  syncActionSchema,
  unique,
  validationFailed,
} from '@orbit/shared';
import { notFound } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { renderMarkdown } from '../markdown/index.ts';
import { hasSlackBotToken } from '../slack/credentials.ts';
import { slackCredentialVersionExpression } from '../slack/dispatch.ts';
import { slackFeatureEnabled } from '../slack/feature.ts';
import {
  applyLiveNotificationConversations,
  compatibleInboxSurface,
  mutateLegacyNotifications,
  type NotificationConversationPlan,
  notificationConversationLookupKey,
  prepareNotificationConversations,
} from './compatibility.ts';
import { type ConversationIdentity, resolveNotificationConversation } from './conversations.ts';
import {
  DEFAULT_SETTINGS,
  disabledPreferenceIndex,
  isChannelEnabled,
  type NotificationSettings,
} from './preferences.ts';
import { isWithinQuietHours, nextQuietHoursEnd, type QuietHours } from './quiet-hours.ts';

export * from './conversation-backfill.ts';
export * from './conversations.ts';
export * from './preferences.ts';
export * from './quiet-hours.ts';

export type NotificationDatabase = Database | Transaction;
export type NotificationRecord = typeof notification.$inferSelect;
export type SlackDmDelivery = typeof notificationDelivery.$inferSelect & {
  readonly notificationId: string;
  readonly userId: string;
};
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
        ...(expectedIntegrationVersion === undefined
          ? []
          : [sql`${slackCredentialVersionExpression()} = ${expectedIntegrationVersion}`]),
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
): Promise<SlackDmDelivery[]> {
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
  const claimed = await database
    .update(notificationDelivery)
    .set({ status: 'processing', claimedAt: now })
    .where(
      sql`${notificationDelivery.id} IN (
        SELECT ${notificationDelivery.id}
        FROM ${notificationDelivery}
        INNER JOIN ${notification}
          ON ${notification.id} = ${notificationDelivery.notificationId}
        WHERE ${notificationDelivery.channel} = 'slack_dm'
          AND ${notificationDelivery.userId} IS NOT NULL
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
        FOR UPDATE OF ${notificationDelivery} SKIP LOCKED
      )`,
    )
    .returning();
  return claimed.filter(isSlackDmDelivery);
}

function isSlackDmDelivery(
  delivery: typeof notificationDelivery.$inferSelect,
): delivery is SlackDmDelivery {
  return delivery.notificationId !== null && delivery.userId !== null;
}

export const DEDUPE_WINDOW_MS = 60_000;
export const INBOX_CHANNEL = 'inbox';

export type NotificationSourceInput = z.input<typeof notificationSourceInputSchema>;

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
  source: notificationSourceInputSchema.optional(),
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

interface SlackDmDestination {
  readonly integrationId: string;
  readonly destinationId: string;
}

interface Plan {
  readonly id: string;
  readonly event: ParsedEvent;
  readonly recipient: Recipient;
  readonly channels: string[];
  readonly emailAt: Date | null;
  readonly emailDeferred: boolean;
  readonly slackDmAt: Date | null;
  readonly slackDmDestination: SlackDmDestination | null;
  readonly sourceEventId: string | null;
  readonly conversation: ConversationIdentity;
}

const slackDmEligibilitySchema = z.object({
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
  if ('$client' in database) {
    return await database.transaction((tx) => notifyMany(tx, events, options));
  }
  const parsed = events.map((event) => notificationEventSchema.parse(event));
  const now = options.now ?? new Date();
  const claimedSources = await claimNotificationSources(
    database,
    parsed,
    now,
    options.sourceDeliveryId,
  );
  const activeEvents = parsed.filter(
    (event) =>
      event.source === undefined ||
      claimedSources.has(sourceIdentity(event.organizationId, event.source.sourceEventKey)),
  );
  let deduped = parsed
    .filter(
      (event) =>
        event.source !== undefined &&
        !claimedSources.has(sourceIdentity(event.organizationId, event.source.sourceEventKey)),
    )
    .reduce(
      (total, event) =>
        total + unique(event.userIds.filter((userId) => userId !== event.actor.id)).length,
      0,
    );
  const slackEnabled = resolveSlackFeatureEnabled(options.slackEnabled);
  const recipientIds = unique(
    activeEvents.flatMap((event) => event.userIds.filter((id) => id !== event.actor.id)),
  );
  if (recipientIds.length === 0) {
    await enqueueSharedSlackDeliveries(database, activeEvents, claimedSources, now, slackEnabled);
    await completeNotificationSources(database, claimedSources, now);
    return { ...emptyOutcome(), deduped };
  }

  const recipients = await loadRecipients(database, recipientIds);
  const settings = await loadSettings(database, recipientIds);
  const slackEnabledEvents = slackEnabled ? activeEvents : [];
  const slackDmEligibleRecipients =
    slackEnabledEvents.length > 0
      ? await loadSlackDmEligibleRecipients(database, slackEnabledEvents, recipientIds)
      : new Map<string, ReadonlyMap<string, SlackDmDestination>>();
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
  for (const event of activeEvents) {
    const sourceEventId =
      event.source === undefined
        ? null
        : (claimedSources.get(sourceIdentity(event.organizationId, event.source.sourceEventKey)) ??
          null);
    for (const userId of event.userIds) {
      const recipient = recipients.get(userId);
      if (userId === event.actor.id || recipient === undefined) continue;
      if (sourceDeliveryKeys.has(userId)) {
        deduped += 1;
        continue;
      }
      const key = dedupeKey(userId, event.type, event.entityId, event.externalUrl ?? null);
      if (event.source === undefined && seen.has(key)) {
        deduped += 1;
        continue;
      }
      const plan = planFor(
        event,
        recipient,
        settings.get(userId) ?? DEFAULT_SETTINGS,
        disabled,
        now,
        slackEnabled,
        slackDmEligibleRecipients.get(event.organizationId)?.get(userId) ?? null,
        sourceEventId,
      );
      if (plan !== null) {
        if (event.source === undefined) seen.add(key);
        plans.push(plan);
      }
    }
  }
  if (plans.length === 0) {
    await enqueueSharedSlackDeliveries(database, activeEvents, claimedSources, now, slackEnabled);
    await completeNotificationSources(database, claimedSources, now);
    return { ...emptyOutcome(), deduped };
  }

  const conversationPlans: NotificationConversationPlan[] = plans.map((plan) => ({
    notificationId: plan.id,
    organizationId: plan.event.organizationId,
    userId: plan.recipient.id,
    conversation: plan.conversation,
  }));
  const conversations = await prepareNotificationConversations(database, conversationPlans, now);
  const rows = await database
    .insert(notification)
    .values(
      plans.map((plan) => {
        const conversation = conversations.get(
          notificationConversationLookupKey(
            plan.event.organizationId,
            plan.recipient.id,
            plan.conversation.conversationKey,
          ),
        );
        if (conversation === undefined) {
          throw validationFailed('Notification conversation could not be created.');
        }
        return toInsert(plan, conversation.id, now);
      }),
    )
    .onConflictDoNothing()
    .returning();
  deduped += plans.length - rows.length;

  await applyLiveNotificationConversations(database, rows, conversationPlans, conversations, now);
  const deliveryRows = slackDeliveryRows(rows, plans, now, options.sourceDeliveryId);
  if (deliveryRows.length > 0) await database.insert(notificationDelivery).values(deliveryRows);
  await enqueueSharedSlackDeliveries(database, activeEvents, claimedSources, now, slackEnabled);
  await completeNotificationSources(database, claimedSources, now);

  return buildOutcome(plans, rows, deduped);
}

function sourceIdentity(organizationId: string, sourceEventKey: string): string {
  return JSON.stringify([organizationId, sourceEventKey]);
}

async function claimNotificationSources(
  database: NotificationDatabase,
  events: readonly ParsedEvent[],
  now: Date,
  sourceDeliveryId: string | undefined,
): Promise<Map<string, string>> {
  const byIdentity = new Map<string, ParsedEvent>();
  for (const event of events) {
    if (event.source === undefined) continue;
    const identity = sourceIdentity(event.organizationId, event.source.sourceEventKey);
    if (!byIdentity.has(identity)) byIdentity.set(identity, event);
  }
  if (byIdentity.size === 0) return new Map();
  const orderedEvents = [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, event]) => event);
  await database
    .insert(notificationSourceEvent)
    .values(
      orderedEvents.map((event) => {
        const source = event.source;
        if (source === undefined) throw validationFailed('Notification source is missing.');
        return {
          id: randomUUIDv7(now),
          organizationId: event.organizationId,
          sourceEventKey: source.sourceEventKey,
          sourceDeliveryId: sourceDeliveryId ?? null,
          subjectType: source.subjectType,
          subjectKey: source.subjectKey,
          occurredAt: source.occurredAt,
          ingestedAt: now,
          payload: source.payload,
          createdAt: now,
          updatedAt: now,
        };
      }),
    )
    .onConflictDoNothing();
  const organizationIds = unique(orderedEvents.map((event) => event.organizationId));
  const sourceEventKeys = unique(
    orderedEvents.flatMap((event) =>
      event.source === undefined ? [] : [event.source.sourceEventKey],
    ),
  );
  const rows = await database
    .select({
      id: notificationSourceEvent.id,
      organizationId: notificationSourceEvent.organizationId,
      sourceEventKey: notificationSourceEvent.sourceEventKey,
      subjectType: notificationSourceEvent.subjectType,
      subjectKey: notificationSourceEvent.subjectKey,
      fanoutCompletedAt: notificationSourceEvent.fanoutCompletedAt,
      prunedAt: notificationSourceEvent.prunedAt,
    })
    .from(notificationSourceEvent)
    .where(
      and(
        inArray(notificationSourceEvent.organizationId, organizationIds),
        inArray(notificationSourceEvent.sourceEventKey, sourceEventKeys),
      ),
    )
    .orderBy(notificationSourceEvent.organizationId, notificationSourceEvent.sourceEventKey)
    .for('update');
  const claimed = new Map<string, string>();
  for (const row of rows) {
    const identity = sourceIdentity(row.organizationId, row.sourceEventKey);
    const requested = byIdentity.get(identity);
    if (requested?.source === undefined) continue;
    if (
      row.subjectType !== requested.source.subjectType ||
      row.subjectKey !== requested.source.subjectKey
    ) {
      throw validationFailed('Notification source identity conflicts with its subject.');
    }
    if (row.fanoutCompletedAt === null && row.prunedAt === null) claimed.set(identity, row.id);
  }
  return claimed;
}

async function completeNotificationSources(
  database: NotificationDatabase,
  claimedSources: ReadonlyMap<string, string>,
  now: Date,
): Promise<void> {
  const ids = [...claimedSources.values()];
  if (ids.length === 0) return;
  await database
    .update(notificationSourceEvent)
    .set({ fanoutCompletedAt: now, updatedAt: now })
    .where(inArray(notificationSourceEvent.id, ids));
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
    if (
      plan === undefined ||
      !plan.channels.includes('slack_dm') ||
      plan.slackDmDestination === null
    ) {
      return [];
    }
    return [
      {
        id: randomUUIDv7(now),
        notificationId: row.id,
        organizationId: row.organizationId,
        sourceEventId: plan.sourceEventId,
        sourceDeliveryId: sourceDeliveryId ?? null,
        userId: row.userId,
        channel: 'slack_dm',
        conversationKey: plan.conversation.conversationKey,
        destinationKind: 'user',
        destinationId: plan.slackDmDestination.destinationId,
        integrationId: plan.slackDmDestination.integrationId,
        availableAt: plan.slackDmAt ?? now,
      },
    ];
  });
}

function resolveSlackFeatureEnabled(value: boolean | undefined): boolean {
  return value ?? slackFeatureEnabled();
}

function planFor(
  event: ParsedEvent,
  recipient: Recipient,
  settings: NotificationSettings,
  disabled: ReadonlySet<string>,
  now: Date,
  slackFeatureEnabled: boolean,
  slackDmDestination: SlackDmDestination | null,
  sourceEventId: string | null,
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
    slackDmDestination !== null &&
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
  const id = randomUUIDv7(now);
  return {
    id,
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
    slackDmDestination,
    sourceEventId,
    conversation: resolveNotificationConversation({
      notificationId: id,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      url: event.url,
      ...(event.source === undefined
        ? {}
        : {
            source: {
              subjectType: event.source.subjectType,
              subjectKey: event.source.subjectKey,
              payload: event.source.payload,
            },
          }),
    }),
  };
}

async function loadSlackDmEligibleRecipients(
  database: NotificationDatabase,
  events: readonly ParsedEvent[],
  recipientIds: readonly string[],
): Promise<Map<string, ReadonlyMap<string, SlackDmDestination>>> {
  const organizationIds = unique(
    events.filter(isPersonalNotification).map((event) => event.organizationId),
  );
  if (organizationIds.length === 0) return new Map();
  const rows = await database
    .select({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      userId: slackUserMapping.userId,
      slackUserId: slackUserMapping.slackUserId,
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
  const eligible = new Map<string, Map<string, SlackDmDestination>>();
  for (const row of rows) {
    const parsed = slackDmEligibilitySchema.safeParse(row);
    if (!(parsed.success && hasSlackBotToken(row.credentials))) continue;
    if (parsed.data.config.slackReauthorize === true) continue;
    const scopes = parsed.data.config.scopes;
    if (!(scopes.includes('chat:write') && scopes.includes('im:write'))) continue;
    const recipients = eligible.get(row.organizationId) ?? new Map<string, SlackDmDestination>();
    recipients.set(row.userId, {
      integrationId: row.integrationId,
      destinationId: row.slackUserId,
    });
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

function toInsert(plan: Plan, conversationId: string, now: Date) {
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
    sourceEventId: plan.sourceEventId,
    conversationId,
    occurredAt: event.source?.occurredAt ?? now,
    ingestedAt: now,
    ingestionSeq: nextSyncId,
    surfaceInInbox: plan.channels.includes(INBOX_CHANNEL),
    deliveredChannels: plan.channels.filter((channel) => channel !== 'slack_dm'),
    syncId: nextSyncId,
    createdAt: now,
  };
}

async function enqueueSharedSlackDeliveries(
  database: NotificationDatabase,
  events: readonly ParsedEvent[],
  claimedSources: ReadonlyMap<string, string>,
  now: Date,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  const sourceEvents = new Map<string, ParsedEvent>();
  for (const event of events) {
    if (event.source?.subjectType !== 'github_pull_request') continue;
    const sourceEventId = claimedSources.get(
      sourceIdentity(event.organizationId, event.source.sourceEventKey),
    );
    if (sourceEventId === undefined || sourceEvents.has(sourceEventId)) continue;
    sourceEvents.set(sourceEventId, event);
  }
  if (sourceEvents.size === 0) return;
  const organizationIds = unique([...sourceEvents.values()].map((event) => event.organizationId));
  const targets = await database
    .select({
      organizationId: slackChannelSync.organizationId,
      integrationId: slackChannelSync.integrationId,
      teamId: slackChannelSync.teamId,
      channelId: slackChannelSync.channelId,
    })
    .from(slackChannelSync)
    .where(
      and(
        inArray(slackChannelSync.organizationId, organizationIds),
        eq(slackChannelSync.enabled, true),
      ),
    );
  const values = [...sourceEvents.entries()].flatMap(([sourceEventId, event]) =>
    targets
      .filter(
        (target) =>
          target.organizationId === event.organizationId &&
          (target.teamId === null || event.source?.teamIds.includes(target.teamId) === true),
      )
      .map((target) => ({
        id: randomUUIDv7(now),
        notificationId: null,
        organizationId: event.organizationId,
        sourceEventId,
        userId: null,
        channel: 'slack',
        conversationKey: event.source?.subjectKey ?? null,
        destinationKind: 'shared_channel',
        destinationId: `${target.integrationId}:${target.channelId}`,
        integrationId: target.integrationId,
        providerPayload: {
          title: event.title,
          body: event.body,
          url: event.url,
          externalUrl: event.externalUrl ?? null,
        },
        availableAt: now,
        createdAt: now,
      })),
  );
  if (values.length === 0) return;
  await database.insert(notificationDelivery).values(values).onConflictDoNothing();
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
        isNull(notification.deduplicatedIntoNotificationId),
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
  if ('$client' in database) {
    return await database.transaction((tx) => markRead(tx, params));
  }
  return await mutateLegacyNotifications(database, {
    kind: 'read',
    userId: params.userId,
    organizationId: params.organizationId,
    notificationIds: params.notificationIds,
    read: params.read,
    now: new Date(),
  });
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
  if ('$client' in database) {
    return await database.transaction((tx) => markAllRead(tx, params));
  }
  const updated = await mutateLegacyNotifications(database, {
    kind: 'read_all',
    userId: params.userId,
    organizationId: params.organizationId,
    now: new Date(),
  });
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
  if ('$client' in database) {
    return await database.transaction((tx) => snooze(tx, params));
  }
  const updated = await mutateLegacyNotifications(database, {
    kind: 'snooze',
    userId: params.userId,
    organizationId: params.organizationId,
    notificationIds: [params.notificationId],
    until: params.until,
    now: new Date(),
  });
  const row = updated[0];
  if (row === undefined) throw validationFailed('That notification does not exist.');
  return row;
}

export const dismissNotificationSchema = z.object({
  userId: idSchema,
  organizationId: idSchema,
  notificationId: idSchema,
});

export async function dismissNotification(
  database: NotificationDatabase,
  input: z.input<typeof dismissNotificationSchema>,
): Promise<NotificationRecord> {
  const params = dismissNotificationSchema.parse(input);
  if ('$client' in database) {
    return await database.transaction((tx) => dismissNotification(tx, params));
  }
  const updated = await mutateLegacyNotifications(database, {
    kind: 'dismiss',
    userId: params.userId,
    organizationId: params.organizationId,
    notificationIds: [params.notificationId],
    now: new Date(),
  });
  const row = updated[0];
  if (row === undefined) throw notFound('That notification does not exist.');
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
    compatibleInboxSurface(),
    isNull(notification.deduplicatedIntoNotificationId),
    isNull(notification.dismissedAt),
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
        compatibleInboxSurface(),
        isNull(notification.deduplicatedIntoNotificationId),
        isNull(notification.dismissedAt),
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
        compatibleInboxSurface(),
        isNull(notification.deduplicatedIntoNotificationId),
        isNull(notification.dismissedAt),
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
