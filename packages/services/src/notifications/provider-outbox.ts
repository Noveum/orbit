import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { type Database, schema, type Transaction } from '@orbit/db';
import {
  notificationEmailPayloadSchema,
  notificationProviderPayloadSchema,
  notificationResendResponseSchema,
  notificationSlackNamespaceSchema,
} from '@orbit/shared';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, count, eq, inArray, isNull, lte, min, or, sql } from 'drizzle-orm';
import { decryptSlackBotToken } from '../slack/credentials.ts';
import { SlackApiError, SlackClient } from '../slack/index.ts';
import {
  absoluteNotificationUrl,
  notificationSlackMessage,
} from '../slack/notification-threads.ts';
import { lockNotificationSubjectAccess } from './conversation-access.ts';

type Delivery = typeof schema.notificationDelivery.$inferSelect;
type Thread = typeof schema.slackNotificationThread.$inferSelect;
type Source = typeof schema.notificationSourceEvent.$inferSelect;
type ProviderDatabase = Database | Transaction;
type Channel = 'slack_dm' | 'slack' | 'email';

const LEASE_MS = 5 * 60_000;
const IDEMPOTENCY_MS = 23 * 60 * 60_000;
const BLOCKING_STATES = ['pending', 'processing', 'failed', 'ambiguous'];
const AUTH_ERRORS = new Set([
  'account_inactive',
  'invalid_auth',
  'missing_scope',
  'not_authed',
  'token_expired',
  'token_revoked',
]);
const PERMANENT_ERRORS = new Set([
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'cannot_dm_bot',
  'user_not_found',
  'user_disabled',
  'restricted_action',
  'invalid_arguments',
  'msg_too_long',
  'no_text',
]);

export interface NotificationProviderWorkerOptions {
  readonly channels?: readonly Channel[];
  readonly organizationId?: string;
  readonly limit?: number;
  readonly concurrency?: number;
  readonly now?: () => Date;
  readonly deadlineAt?: Date;
  readonly fetch?: typeof globalThis.fetch;
}

interface Claim {
  readonly delivery: Delivery;
  readonly thread: Thread | null;
}

interface Prepared extends Claim {
  readonly payload: unknown;
  readonly token: string | null;
  readonly channelId: string | null;
  readonly email: ReturnType<typeof notificationEmailPayloadSchema.parse> | null;
}

function threadIdentity(delivery: Delivery) {
  return and(
    eq(schema.slackNotificationThread.organizationId, delivery.organizationId ?? ''),
    eq(schema.slackNotificationThread.integrationId, delivery.integrationId ?? ''),
    eq(schema.slackNotificationThread.slackTeamId, delivery.slackTeamId ?? ''),
    eq(schema.slackNotificationThread.slackAppId, delivery.slackAppId ?? ''),
    eq(schema.slackNotificationThread.destinationKind, delivery.destinationKind ?? ''),
    eq(schema.slackNotificationThread.destinationId, delivery.destinationId ?? ''),
    eq(schema.slackNotificationThread.conversationKey, delivery.conversationKey ?? ''),
  );
}

function deliveryIdentity(delivery: Delivery) {
  return and(
    eq(schema.notificationDelivery.organizationId, delivery.organizationId ?? ''),
    eq(schema.notificationDelivery.channel, delivery.channel),
    eq(schema.notificationDelivery.integrationId, delivery.integrationId ?? ''),
    eq(schema.notificationDelivery.slackTeamId, delivery.slackTeamId ?? ''),
    eq(schema.notificationDelivery.slackAppId, delivery.slackAppId ?? ''),
    eq(schema.notificationDelivery.destinationKind, delivery.destinationKind ?? ''),
    eq(schema.notificationDelivery.destinationId, delivery.destinationId ?? ''),
    eq(schema.notificationDelivery.conversationKey, delivery.conversationKey ?? ''),
  );
}

function owned(delivery: Delivery) {
  return and(
    eq(schema.notificationDelivery.id, delivery.id),
    eq(schema.notificationDelivery.status, 'processing'),
    eq(schema.notificationDelivery.claimToken, delivery.claimToken ?? ''),
  );
}

async function lockThread(tx: Transaction, delivery: Delivery): Promise<Thread | null> {
  const [thread] = await tx
    .select()
    .from(schema.slackNotificationThread)
    .where(threadIdentity(delivery))
    .for('update');
  return thread ?? null;
}

type NamespacedSlackDelivery = Delivery & {
  organizationId: string;
  integrationId: string;
  slackTeamId: string;
  slackAppId: string;
  conversationKey: string;
  destinationId: string;
  destinationKind: string;
};

function hasSlackNamespace(delivery: Delivery): delivery is NamespacedSlackDelivery {
  return [
    delivery.organizationId,
    delivery.integrationId,
    delivery.slackTeamId,
    delivery.slackAppId,
    delivery.conversationKey,
    delivery.destinationId,
    delivery.destinationKind,
  ].every((value) => value !== null && value.length > 0);
}

async function claimSlack(tx: Transaction, candidate: Delivery, now: Date): Promise<Claim | null> {
  const [integration] = await tx
    .select({ config: schema.integration.config })
    .from(schema.integration)
    .where(eq(schema.integration.id, candidate.integrationId ?? ''));
  if (integration?.config['notificationDeliveryState'] === 'draining') return null;
  if (!hasSlackNamespace(candidate)) {
    await tx
      .update(schema.notificationDelivery)
      .set({ status: 'unavailable', lastError: 'destination_namespace_missing' })
      .where(
        and(
          eq(schema.notificationDelivery.id, candidate.id),
          inArray(schema.notificationDelivery.status, ['pending', 'failed']),
        ),
      );
    return null;
  }
  await tx
    .insert(schema.slackNotificationThread)
    .values({
      id: randomUUIDv7(now),
      organizationId: candidate.organizationId,
      integrationId: candidate.integrationId,
      slackTeamId: candidate.slackTeamId,
      slackAppId: candidate.slackAppId,
      credentialGeneration: candidate.credentialGeneration ?? 0,
      destinationKind: candidate.destinationKind,
      destinationId: candidate.destinationId,
      conversationKey: candidate.conversationKey,
      state: 'creating',
    })
    .onConflictDoNothing();
  let thread = await lockThread(tx, candidate);
  if (thread === null || ['archived', 'ambiguous'].includes(thread.state)) return null;
  const [head] = await tx
    .select({ delivery: schema.notificationDelivery })
    .from(schema.notificationDelivery)
    .innerJoin(
      schema.notificationSourceEvent,
      eq(schema.notificationSourceEvent.id, schema.notificationDelivery.sourceEventId),
    )
    .where(
      and(
        deliveryIdentity(candidate),
        isNull(schema.notificationDelivery.deduplicatedIntoDeliveryId),
        inArray(schema.notificationDelivery.status, BLOCKING_STATES),
      ),
    )
    .orderBy(asc(schema.notificationSourceEvent.ingestionSeq), asc(schema.notificationDelivery.id))
    .limit(1)
    .for('update', { of: schema.notificationDelivery });
  if (head === undefined) return null;
  const delivery = head.delivery;
  if (!(await canClaimSlackHead(tx, delivery, thread, now))) return null;
  const claimToken = randomUUIDv7(now);
  const [claimed] = await tx
    .update(schema.notificationDelivery)
    .set({
      status: 'processing',
      claimToken,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      providerRequestId: delivery.providerRequestId ?? `notification/${delivery.id}`,
    })
    .where(eq(schema.notificationDelivery.id, delivery.id))
    .returning();
  if (claimed === undefined) return null;
  if (thread.rootTs === null) {
    const [updated] = await tx
      .update(schema.slackNotificationThread)
      .set({
        state: 'creating',
        claimToken,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        createdByDeliveryId: delivery.id,
        updatedAt: now,
      })
      .where(eq(schema.slackNotificationThread.id, thread.id))
      .returning();
    thread = updated ?? thread;
  }
  return { delivery: claimed, thread };
}

async function canClaimSlackHead(
  tx: Transaction,
  delivery: Delivery,
  thread: Thread,
  now: Date,
): Promise<boolean> {
  if (delivery.status === 'ambiguous' || delivery.availableAt > now) return false;
  if (delivery.status !== 'processing') return true;
  if (delivery.leaseExpiresAt === null || delivery.leaseExpiresAt > now) return false;
  if (delivery.sendStartedAt === null) return true;
  await tx
    .update(schema.notificationDelivery)
    .set({ status: 'ambiguous', lastError: 'provider_result_unconfirmed' })
    .where(owned(delivery));
  if (thread.rootTs === null)
    await tx
      .update(schema.slackNotificationThread)
      .set({ state: 'ambiguous', lastError: 'provider_result_unconfirmed', updatedAt: now })
      .where(eq(schema.slackNotificationThread.id, thread.id));
  return false;
}

async function claimEmail(tx: Transaction, candidate: Delivery, now: Date): Promise<Claim | null> {
  const [delivery] = await tx
    .select()
    .from(schema.notificationDelivery)
    .where(
      and(
        eq(schema.notificationDelivery.id, candidate.id),
        isNull(schema.notificationDelivery.deduplicatedIntoDeliveryId),
      ),
    )
    .for('update', { skipLocked: true });
  if (
    delivery === undefined ||
    !['pending', 'failed', 'processing'].includes(delivery.status) ||
    delivery.availableAt > now
  )
    return null;
  if (
    delivery.status === 'processing' &&
    (delivery.leaseExpiresAt === null || delivery.leaseExpiresAt > now)
  )
    return null;
  if (
    delivery.sendStartedAt !== null &&
    (delivery.providerIdempotencyExpiresAt === null || delivery.providerIdempotencyExpiresAt <= now)
  ) {
    await tx
      .update(schema.notificationDelivery)
      .set({ status: 'ambiguous', lastError: 'idempotency_window_expired' })
      .where(eq(schema.notificationDelivery.id, delivery.id));
    return null;
  }
  const [claimed] = await tx
    .update(schema.notificationDelivery)
    .set({
      status: 'processing',
      claimToken: randomUUIDv7(now),
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      providerRequestId: delivery.providerRequestId ?? `notification/${delivery.id}`,
    })
    .where(eq(schema.notificationDelivery.id, delivery.id))
    .returning();
  return claimed === undefined ? null : { delivery: claimed, thread: null };
}

async function claimCandidate(database: ProviderDatabase, candidate: Delivery, now: Date) {
  return await database.transaction(async (tx) =>
    candidate.channel === 'email'
      ? await claimEmail(tx, candidate, now)
      : await claimSlack(tx, candidate, now),
  );
}

function sourceSubjectId(source: Source): string | undefined {
  const value =
    source.payload?.['pullRequestId'] ??
    source.payload?.['subjectId'] ??
    source.payload?.['entityId'];
  return typeof value === 'string' ? value : undefined;
}

function encryptionKey() {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) throw new Error('Notification payload encryption is unavailable.');
  return new Uint8Array(hkdfSync('sha256', secret, '', 'orbit/notification-email/v1', 32));
}

function freezeEmail(
  delivery: Delivery,
  payload: ReturnType<typeof notificationEmailPayloadSchema.parse>,
) {
  const plaintext = JSON.stringify(payload);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), Uint8Array.from(iv));
  cipher.setAAD(new TextEncoder().encode(`${delivery.organizationId}:${delivery.id}`));
  const ciphertext = Buffer.concat([
    Uint8Array.from(cipher.update(plaintext, 'utf8')),
    Uint8Array.from(cipher.final()),
  ]);
  return {
    providerPayload: {
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    },
    providerPayloadHash: createHash('sha256').update(plaintext).digest('hex'),
  };
}

function thawEmail(delivery: Delivery) {
  const envelope = delivery.providerPayload;
  if (
    envelope === null ||
    typeof envelope['iv'] !== 'string' ||
    typeof envelope['tag'] !== 'string' ||
    typeof envelope['ciphertext'] !== 'string'
  )
    throw new Error('Invalid notification payload.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Uint8Array.from(Buffer.from(envelope['iv'], 'base64url')),
  );
  decipher.setAAD(new TextEncoder().encode(`${delivery.organizationId}:${delivery.id}`));
  decipher.setAuthTag(Uint8Array.from(Buffer.from(envelope['tag'], 'base64url')));
  const plaintext = Buffer.concat([
    Uint8Array.from(
      decipher.update(Uint8Array.from(Buffer.from(envelope['ciphertext'], 'base64url'))),
    ),
    Uint8Array.from(decipher.final()),
  ]).toString('utf8');
  if (createHash('sha256').update(plaintext).digest('hex') !== delivery.providerPayloadHash)
    throw new Error('Notification payload hash mismatch.');
  return notificationEmailPayloadSchema.parse(JSON.parse(plaintext));
}

interface ProviderSubject {
  readonly source: Source | undefined;
  readonly recipientEvent: typeof schema.notification.$inferSelect | undefined;
  readonly initialMapping: typeof schema.slackChannelSync.$inferSelect | undefined;
}

interface SlackDestination {
  readonly token: string | null;
  readonly channelId: string | null;
  readonly error: string | null;
  readonly draining: boolean;
}

async function loadProviderSubject(tx: Transaction, delivery: Delivery): Promise<ProviderSubject> {
  const [source] = await tx
    .select()
    .from(schema.notificationSourceEvent)
    .where(
      and(
        eq(schema.notificationSourceEvent.id, delivery.sourceEventId ?? ''),
        eq(schema.notificationSourceEvent.organizationId, delivery.organizationId ?? ''),
      ),
    );
  const [recipientEvent] = await tx
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.id, delivery.notificationId ?? ''),
        isNull(schema.notification.deduplicatedIntoNotificationId),
      ),
    );
  const [initialMapping] = await tx
    .select()
    .from(schema.slackChannelSync)
    .where(
      and(
        eq(schema.slackChannelSync.organizationId, delivery.organizationId ?? ''),
        eq(schema.slackChannelSync.integrationId, delivery.integrationId ?? ''),
        sql`${delivery.destinationId} = ${schema.slackChannelSync.integrationId} || ':' || ${schema.slackChannelSync.channelId}`,
      ),
    );
  return { source, recipientEvent, initialMapping };
}

async function subjectAllowed(tx: Transaction, delivery: Delivery, subject: ProviderSubject) {
  if (subject.source === undefined) return false;
  const subjectId = sourceSubjectId(subject.source);
  return await lockNotificationSubjectAccess(tx, {
    organizationId: delivery.organizationId ?? '',
    subjectType: subject.source.subjectType,
    subjectKey: subject.source.subjectKey,
    ...(subjectId === undefined ? {} : { subjectId }),
    ...(delivery.userId === null
      ? { teamId: subject.initialMapping?.teamId ?? null }
      : { userId: delivery.userId }),
  });
}

async function subjectStillRelevant(tx: Transaction, delivery: Delivery, subject: ProviderSubject) {
  const type = subject.recipientEvent?.type ?? delivery.providerPayload?.['notificationType'];
  if (type !== 'pr_checks_failed') return true;
  const pullRequestId = subject.source?.payload?.['pullRequestId'];
  const headSha = subject.source?.payload?.['headSha'];
  if (typeof pullRequestId !== 'string' || typeof headSha !== 'string' || headSha.length === 0)
    return false;
  const [pull] = await tx
    .select({ id: schema.githubPullRequest.id })
    .from(schema.githubPullRequest)
    .where(
      and(
        eq(schema.githubPullRequest.organizationId, delivery.organizationId ?? ''),
        eq(schema.githubPullRequest.id, pullRequestId),
        eq(schema.githubPullRequest.headSha, headSha),
        eq(schema.githubPullRequest.checkStatus, 'failure'),
        eq(schema.githubPullRequest.state, 'open'),
        eq(schema.githubPullRequest.merged, false),
      ),
    )
    .for('share');
  return pull !== undefined;
}

async function slackConnection(
  tx: Transaction,
  delivery: Delivery,
): Promise<SlackDestination & { readonly dmAllowed: boolean }> {
  const [connection] = await tx
    .select()
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.id, delivery.integrationId ?? ''),
        eq(schema.integration.organizationId, delivery.organizationId ?? ''),
        eq(schema.integration.provider, 'slack'),
      ),
    )
    .for('update');
  const namespace = notificationSlackNamespaceSchema.safeParse({
    ...connection?.config,
    slackAppId: connection?.config['slackAppId'] ?? process.env['SLACK_APP_ID'],
  });
  const unavailable = {
    token: null,
    channelId: null,
    error: 'integration_namespace_changed',
    draining: connection?.config['notificationDeliveryState'] === 'draining',
    dmAllowed: false,
  };
  if (connection === undefined || !namespace.success) return unavailable;
  if (
    namespace.data.slackTeamId !== delivery.slackTeamId ||
    namespace.data.slackAppId !== delivery.slackAppId ||
    namespace.data.credentialGeneration !== delivery.credentialGeneration
  )
    return unavailable;
  if (
    namespace.data.notificationDeliveryState !== 'active' ||
    namespace.data.slackReauthorize ||
    !namespace.data.scopes.includes('chat:write')
  )
    return unavailable;
  try {
    const token = decryptSlackBotToken(connection.credentials, {
      organizationId: connection.organizationId,
      integrationId: connection.id,
    });
    return {
      ...unavailable,
      token,
      error: token === null ? 'credential_unavailable' : null,
      dmAllowed: namespace.data.scopes.includes('im:write'),
    };
  } catch {
    return { ...unavailable, error: 'credential_unavailable' };
  }
}

async function slackDestination(
  tx: Transaction,
  delivery: Delivery,
  subject: ProviderSubject,
): Promise<SlackDestination> {
  const connection = await slackConnection(tx, delivery);
  if (connection.error !== null) return connection;
  if (delivery.channel === 'slack_dm') {
    const [mapping] = await tx
      .select()
      .from(schema.slackUserMapping)
      .where(
        and(
          eq(schema.slackUserMapping.integrationId, delivery.integrationId ?? ''),
          eq(schema.slackUserMapping.organizationId, delivery.organizationId ?? ''),
          eq(schema.slackUserMapping.userId, delivery.userId ?? ''),
          eq(schema.slackUserMapping.slackUserId, delivery.destinationId ?? ''),
        ),
      )
      .for('share');
    return {
      ...connection,
      channelId: mapping?.slackChannelId ?? null,
      error:
        mapping === undefined || !connection.dmAllowed ? 'recipient_mapping_unavailable' : null,
    };
  }
  const [mapping] = await tx
    .select()
    .from(schema.slackChannelSync)
    .where(eq(schema.slackChannelSync.id, subject.initialMapping?.id ?? ''))
    .for('share');
  if (
    mapping === undefined ||
    !mapping.enabled ||
    mapping.teamId !== subject.initialMapping?.teamId ||
    mapping.organizationId !== delivery.organizationId ||
    mapping.integrationId !== delivery.integrationId ||
    `${mapping.integrationId}:${mapping.channelId}` !== delivery.destinationId
  )
    return { ...connection, error: 'channel_mapping_unavailable' };
  const notificationType = delivery.providerPayload?.['notificationType'];
  if (
    mapping.events.length > 0 &&
    (typeof notificationType !== 'string' || !mapping.events.includes(notificationType))
  )
    return { ...connection, error: 'channel_event_disabled' };
  return { ...connection, channelId: mapping.channelId };
}

async function recipientEmail(
  tx: Transaction,
  delivery: Delivery,
  event: ProviderSubject['recipientEvent'],
): Promise<{ readonly error: string | null; readonly email: Prepared['email'] }> {
  const [recipient] = await tx
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, delivery.userId ?? ''))
    .for('share');
  if (recipient === undefined || !recipient.emailVerified)
    return { error: 'verified_email_unavailable', email: null };
  if (delivery.providerPayload !== null) {
    const email = thawEmail(delivery);
    if (email.to === recipient.email) return { error: null, email };
    return {
      error: delivery.sendStartedAt === null ? 'verified_email_changed' : 'attempted_email_changed',
      email,
    };
  }
  if (event === undefined) return { error: 'recipient_event_unavailable', email: null };
  return {
    error: null,
    email: notificationEmailPayloadSchema.parse({
      from: process.env['EMAIL_FROM'] ?? '',
      to: recipient.email,
      subject: event.title,
      text: `${event.body}\n\n${absoluteNotificationUrl(event.url)}`,
    }),
  };
}

async function recipientPreflight(
  tx: Transaction,
  delivery: Delivery,
  event: ProviderSubject['recipientEvent'],
) {
  if (delivery.userId === null) return { error: null, email: null };
  await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, delivery.userId))
    .for('share');
  const [preference] = await tx
    .select()
    .from(schema.notificationPreference)
    .where(
      and(
        eq(schema.notificationPreference.userId, delivery.userId),
        eq(schema.notificationPreference.channel, delivery.channel),
        eq(schema.notificationPreference.type, event?.type ?? ''),
      ),
    )
    .for('share');
  if (
    preference?.enabled === false ||
    event === undefined ||
    event.userId !== delivery.userId ||
    event.sourceEventId !== delivery.sourceEventId
  )
    return { error: 'recipient_preference_unavailable', email: null };
  return delivery.channel === 'email'
    ? await recipientEmail(tx, delivery, event)
    : { error: null, email: null };
}

function threadClaimIsCurrent(thread: Thread | null, delivery: Delivery) {
  if (thread === null) return true;
  if (
    thread.credentialGeneration !== delivery.credentialGeneration ||
    ['ambiguous', 'archived'].includes(thread.state)
  )
    return false;
  return thread.rootTs !== null || thread.claimToken === delivery.claimToken;
}

async function markPreflightUnavailable(
  tx: Transaction,
  delivery: Delivery,
  error: string,
  draining: boolean,
  now: Date,
) {
  let status = 'unavailable';
  if (draining) status = 'failed';
  else if (delivery.channel === 'email' && delivery.sendStartedAt !== null) status = 'ambiguous';
  await tx
    .update(schema.notificationDelivery)
    .set({
      status,
      lastError: draining ? 'integration_draining' : error,
      ...(draining ? { availableAt: new Date(now.getTime() + 60_000) } : {}),
    })
    .where(owned(delivery));
}

async function recordProviderStart(
  tx: Transaction,
  current: Delivery,
  email: Prepared['email'],
  now: Date,
) {
  const frozen =
    current.channel === 'email' && current.providerPayload === null && email !== null
      ? freezeEmail(current, email)
      : {};
  const [started] = await tx
    .update(schema.notificationDelivery)
    .set({
      ...frozen,
      sendStartedAt: current.sendStartedAt ?? now,
      attempts: current.attempts + 1,
      ...(current.channel === 'email' && current.providerIdempotencyExpiresAt === null
        ? { providerIdempotencyExpiresAt: new Date(now.getTime() + IDEMPOTENCY_MS) }
        : {}),
    })
    .where(owned(current))
    .returning();
  return started;
}

function providerPreflightError(
  allowed: boolean,
  relevant: boolean,
  destinationError: string | null,
  recipientError: string | null,
) {
  if (!allowed) return 'subject_access_lost';
  if (!relevant) return 'github_check_failure_superseded';
  return destinationError ?? recipientError;
}

async function preflight(
  database: ProviderDatabase,
  claim: Claim,
  clock: () => Date,
): Promise<Prepared | null> {
  return await database.transaction(async (tx) => {
    const delivery = claim.delivery;
    const subject = await loadProviderSubject(tx, delivery);
    const allowed = await subjectAllowed(tx, delivery, subject);
    const relevant = await subjectStillRelevant(tx, delivery, subject);
    const destination =
      delivery.channel === 'email'
        ? { token: null, channelId: null, error: null, draining: false }
        : await slackDestination(tx, delivery, subject);
    const recipient = await recipientPreflight(tx, delivery, subject.recipientEvent);
    const thread = claim.thread === null ? null : await lockThread(tx, delivery);
    const [current] = await tx
      .select()
      .from(schema.notificationDelivery)
      .where(owned(delivery))
      .for('update');
    const now = clock();
    if (
      current === undefined ||
      current.leaseExpiresAt === null ||
      current.leaseExpiresAt <= now ||
      !threadClaimIsCurrent(thread, delivery)
    )
      return null;
    const error = providerPreflightError(allowed, relevant, destination.error, recipient.error);
    if (error !== null) {
      await markPreflightUnavailable(tx, current, error, destination.draining, now);
      return null;
    }
    const payload = subject.recipientEvent ?? current.providerPayload;
    if (current.channel !== 'email') {
      const validated = notificationProviderPayloadSchema.parse(payload);
      absoluteNotificationUrl(validated.externalUrl ?? validated.url);
    }
    const started = await recordProviderStart(tx, current, recipient.email, now);
    return started === undefined
      ? null
      : {
          delivery: started,
          thread,
          payload,
          token: destination.token,
          channelId: destination.channelId,
          email: recipient.email,
        };
  });
}

interface ProviderResult {
  readonly status: string;
  readonly error?: string;
  readonly channel?: string;
  readonly ts?: string;
  readonly providerId?: string;
  readonly retryAfterMs?: number;
}

function finalDeliveryState(current: Delivery, result: ProviderResult, now: Date) {
  let status = result.status;
  if (status === 'failed' && current.attempts >= 5)
    status =
      current.channel === 'email' && current.sendStartedAt !== null ? 'ambiguous' : 'dead_letter';
  const retryMs = Math.max(
    result.retryAfterMs ?? 0,
    Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, current.attempts - 1)),
  );
  if (
    status === 'failed' &&
    current.channel === 'email' &&
    current.providerIdempotencyExpiresAt !== null &&
    now.getTime() + retryMs >= current.providerIdempotencyExpiresAt.getTime()
  )
    status = 'ambiguous';
  return {
    status,
    lastError: result.error ?? null,
    providerMessageId: result.providerId ?? result.ts ?? null,
    providerMessageChannel: result.channel ?? null,
    providerMessageTs: result.ts ?? null,
    deliveredAt: status === 'delivered' ? now : null,
    deadLetteredAt: status === 'dead_letter' ? now : null,
    availableAt: status === 'failed' ? new Date(now.getTime() + retryMs) : current.availableAt,
    ...(status === 'failed' && current.channel !== 'email' ? { sendStartedAt: null } : {}),
  };
}

async function finalizeThread(
  tx: Transaction,
  thread: Thread | null,
  status: string,
  result: ProviderResult,
  now: Date,
) {
  if (thread === null || thread.rootTs !== null) return;
  let state = 'blocked';
  if (status === 'delivered') state = 'ready';
  else if (status === 'ambiguous') state = 'ambiguous';
  await tx
    .update(schema.slackNotificationThread)
    .set({
      state,
      rootTs: result.ts ?? null,
      channelId: result.channel ?? null,
      lastError: result.error ?? null,
      claimToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(schema.slackNotificationThread.id, thread.id));
}

async function finalize(
  database: ProviderDatabase,
  claim: Claim,
  result: ProviderResult,
  clock: () => Date,
): Promise<boolean> {
  return await database.transaction(async (tx) => {
    const delivery = claim.delivery;
    if (delivery.notificationId !== null)
      await tx
        .select({ id: schema.notification.id })
        .from(schema.notification)
        .where(eq(schema.notification.id, delivery.notificationId))
        .for('update');
    const thread = claim.thread === null ? null : await lockThread(tx, delivery);
    const [current] = await tx
      .select()
      .from(schema.notificationDelivery)
      .where(owned(delivery))
      .for('update');
    const now = clock();
    if (
      current === undefined ||
      current.leaseExpiresAt === null ||
      current.leaseExpiresAt <= now ||
      !threadClaimIsCurrent(thread, delivery)
    )
      return false;
    const final = finalDeliveryState(current, result, now);
    await tx.update(schema.notificationDelivery).set(final).where(owned(delivery));
    await finalizeThread(tx, thread, final.status, result, now);
    if (final.status === 'delivered' && delivery.notificationId !== null)
      await tx
        .update(schema.notification)
        .set({
          deliveredChannels: sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements_text(${schema.notification.deliveredChannels} || ${JSON.stringify([delivery.channel])}::jsonb) item(value))`,
        })
        .where(
          and(
            eq(schema.notification.id, delivery.notificationId),
            isNull(schema.notification.deduplicatedIntoNotificationId),
          ),
        );
    return final.status === 'delivered';
  });
}

async function deliverClaim(
  database: ProviderDatabase,
  claim: Claim,
  options: NotificationProviderWorkerOptions,
  now: () => Date,
): Promise<number> {
  let prepared: Prepared | null;
  try {
    prepared = await preflight(database, claim, now);
  } catch {
    await finalize(
      database,
      claim,
      {
        status: claim.delivery.sendStartedAt === null ? 'failed' : 'ambiguous',
        error: 'provider_preflight_failed',
      },
      now,
    );
    return 0;
  }
  if (prepared === null) return 0;
  const fetch = options.fetch ?? globalThis.fetch;
  if (prepared.delivery.channel === 'email')
    return await deliverEmail(database, prepared, fetch, now);
  try {
    const client = new SlackClient({ token: prepared.token ?? '', fetch });
    const channel =
      prepared.thread?.channelId ??
      prepared.channelId ??
      (await client.openConversation(prepared.delivery.destinationId ?? '')).channel;
    const result = await client.postMessage(
      notificationSlackMessage({
        channel,
        rootTs: prepared.thread?.rootTs ?? null,
        payload: prepared.payload,
      }),
    );
    return (await finalize(
      database,
      prepared,
      { status: 'delivered', channel: result.channel, ts: result.ts },
      now,
    ))
      ? 1
      : 0;
  } catch (error) {
    await finalizeSlackFailure(database, prepared, error, now);
    return 0;
  }
}

async function finalizeSlackFailure(
  database: ProviderDatabase,
  prepared: Prepared,
  error: unknown,
  now: () => Date,
) {
  const code = error instanceof SlackApiError ? error.code : 'transport_result_unknown';
  const ambiguous =
    !(error instanceof SlackApiError) ||
    ['internal_error', 'fatal_error', 'request_timeout'].includes(code);
  let status = 'failed';
  if (ambiguous) status = 'ambiguous';
  else if (AUTH_ERRORS.has(code) || PERMANENT_ERRORS.has(code)) status = 'unavailable';
  await finalize(
    database,
    prepared,
    {
      status,
      error: code,
      ...(error instanceof SlackApiError && error.retryAfterMs !== undefined
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    },
    now,
  );
  if (AUTH_ERRORS.has(code))
    await database
      .update(schema.integration)
      .set({
        config: sql`jsonb_set(${schema.integration.config}, '{slackReauthorize}', 'true'::jsonb)`,
      })
      .where(
        and(
          eq(schema.integration.id, prepared.delivery.integrationId ?? ''),
          sql`coalesce((${schema.integration.config}->>'credentialGeneration')::bigint,0) = ${prepared.delivery.credentialGeneration}`,
        ),
      );
}

async function deliverEmail(
  database: ProviderDatabase,
  prepared: Prepared,
  fetch: typeof globalThis.fetch,
  now: () => Date,
): Promise<number> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env['RESEND_API_KEY'] ?? ''}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': prepared.delivery.providerRequestId ?? '',
      },
      body: JSON.stringify(prepared.email),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      let status = 'failed';
      if (response.status === 409) status = 'ambiguous';
      else if ([400, 401, 403, 404, 422].includes(response.status)) status = 'unavailable';
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      await finalize(
        database,
        prepared,
        {
          status,
          error: `resend_http_${response.status}`,
          ...(Number.isFinite(retryAfterSeconds)
            ? { retryAfterMs: Math.max(0, retryAfterSeconds * 1000) }
            : {}),
        },
        now,
      );
      return 0;
    }
    const result = notificationResendResponseSchema.parse(await response.json());
    return (await finalize(database, prepared, { status: 'delivered', providerId: result.id }, now))
      ? 1
      : 0;
  } catch {
    await finalize(
      database,
      prepared,
      { status: 'failed', error: 'resend_result_unconfirmed' },
      now,
    );
    return 0;
  }
}

export async function deliverNotificationProviders(
  database: ProviderDatabase,
  options: NotificationProviderWorkerOptions = {},
): Promise<number> {
  const now = options.now ?? (() => new Date());
  const deadline = options.deadlineAt ?? new Date(now().getTime() + 270_000);
  const limit = Math.min(100, Math.max(0, Math.floor(options.limit ?? 100)));
  const concurrency = Math.min(5, Math.max(1, Math.floor(options.concurrency ?? 5)));
  const channels = [...(options.channels ?? ['slack_dm', 'slack', 'email'])];
  if (channels.length === 0 || limit === 0) return 0;
  let delivered = 0;
  let attempted = 0;
  const seen = new Set<string>();
  while (attempted < limit && now() < deadline) {
    const candidates = await database
      .select()
      .from(schema.notificationDelivery)
      .where(
        and(
          inArray(schema.notificationDelivery.channel, channels),
          inArray(schema.notificationDelivery.status, ['pending', 'failed', 'processing']),
          or(
            sql`${schema.notificationDelivery.status} <> 'processing'`,
            lte(schema.notificationDelivery.leaseExpiresAt, now()),
          ),
          lte(schema.notificationDelivery.availableAt, now()),
          isNull(schema.notificationDelivery.deduplicatedIntoDeliveryId),
          sql`${schema.notificationDelivery.sourceEventId} is not null`,
          sql`(${schema.notificationDelivery.channel} = 'email' or not exists (
            select 1 from notification_delivery earlier
            join notification_source_event earlier_source on earlier_source.id = earlier.source_event_id
            join notification_source_event current_source on current_source.id = ${schema.notificationDelivery.sourceEventId}
            where earlier.organization_id = ${schema.notificationDelivery.organizationId}
              and earlier.channel = ${schema.notificationDelivery.channel}
              and earlier.integration_id = ${schema.notificationDelivery.integrationId}
              and earlier.slack_team_id = ${schema.notificationDelivery.slackTeamId}
              and earlier.slack_app_id = ${schema.notificationDelivery.slackAppId}
              and earlier.destination_kind = ${schema.notificationDelivery.destinationKind}
              and earlier.destination_id = ${schema.notificationDelivery.destinationId}
              and earlier.conversation_key = ${schema.notificationDelivery.conversationKey}
              and earlier.deduplicated_into_delivery_id is null
              and earlier.status in ('pending', 'failed', 'processing', 'ambiguous')
              and (earlier_source.ingestion_seq, earlier.id) < (current_source.ingestion_seq, ${schema.notificationDelivery.id})
          ))`,
          or(
            sql`${schema.notificationDelivery.notificationId} is null`,
            sql`exists(select 1 from notification where id = ${schema.notificationDelivery.notificationId} and deduplicated_into_notification_id is null)`,
          ),
          ...(options.organizationId === undefined
            ? []
            : [eq(schema.notificationDelivery.organizationId, options.organizationId)]),
        ),
      )
      .orderBy(asc(schema.notificationDelivery.availableAt), asc(schema.notificationDelivery.id))
      .limit(limit * 4);
    const batch = candidates
      .filter((candidate) => !seen.has(candidate.id))
      .slice(0, Math.min(concurrency, limit - attempted));
    if (batch.length === 0) break;
    const results = await Promise.all(
      batch.map(async (candidate) => {
        const claim = await claimCandidate(database, candidate, now());
        if (claim === null) {
          seen.add(candidate.id);
          return 0;
        }
        seen.add(claim.delivery.id);
        attempted += 1;
        return await deliverClaim(database, claim, options, now);
      }),
    );
    delivered += results.reduce((sum, value) => sum + value, 0);
  }
  return delivered;
}

export async function notificationProviderHealth(
  database: ProviderDatabase,
  organizationId: string,
) {
  return await database
    .select({
      channel: schema.notificationDelivery.channel,
      status: schema.notificationDelivery.status,
      count: count(),
      oldestAt: min(schema.notificationDelivery.createdAt),
    })
    .from(schema.notificationDelivery)
    .where(
      and(
        eq(schema.notificationDelivery.organizationId, organizationId),
        isNull(schema.notificationDelivery.deduplicatedIntoDeliveryId),
      ),
    )
    .groupBy(schema.notificationDelivery.channel, schema.notificationDelivery.status);
}
