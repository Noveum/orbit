import { describe, expect, it } from 'bun:test';
import { db } from '@orbit/db';
import {
  integration,
  notification,
  notificationConversation,
  notificationConversationBackfillProgress,
  notificationDelivery,
  notificationInboxState,
  notificationSourceEvent,
  organization,
  user,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq } from 'drizzle-orm';
import {
  type ConversationBackfillBatchResult,
  type ConversationBackfillPhase,
  type ConversationBackfillProgress,
  type ConversationBackfillStore,
  classifyLegacyDeliveryGroup,
  foldLegacyRecipientGroup,
  type LegacyDeliveryCandidate,
  type LegacyRecipientCandidate,
  runNotificationConversationBackfill,
  runResumableConversationBackfill,
  selectCompleteEquivalenceBatch,
  selectLegacyRecipientSurvivor,
  verifyNotificationConversationBackfill,
} from '../../src/notifications/conversation-backfill.ts';

const january = new Date('2026-01-01T00:00:00.000Z');
const february = new Date('2026-02-01T00:00:00.000Z');
const march = new Date('2026-03-01T00:00:00.000Z');
const april = new Date('2026-04-01T00:00:00.000Z');

function recipient(
  id: string,
  overrides: Partial<LegacyRecipientCandidate> = {},
): LegacyRecipientCandidate {
  return {
    id,
    sourceEventId: null,
    createdAt: january,
    deliveredChannels: ['inbox'],
    readAt: january,
    snoozedUntil: null,
    dismissedAt: null,
    manualUnreadAnchor: false,
    surfaceInInbox: null,
    ...overrides,
  };
}

function delivery(
  id: string,
  status: string,
  overrides: Partial<LegacyDeliveryCandidate> = {},
): LegacyDeliveryCandidate {
  return {
    id,
    status,
    deliveredAt: null,
    createdAt: january,
    availableAt: january,
    claimedAt: null,
    sendStartedAt: null,
    providerMessageId: null,
    providerMessageChannel: null,
    providerMessageTs: null,
    ...overrides,
  };
}

describe('conversation backfill planning', () => {
  it('takes deterministic primary-key batches without splitting an equivalence group', () => {
    const rows = [
      { id: 'n_03', equivalenceKey: 'source-a' },
      { id: 'n_01', equivalenceKey: 'source-a' },
      { id: 'n_02', equivalenceKey: 'source-b' },
      { id: 'n_04', equivalenceKey: 'source-b' },
      { id: 'n_05', equivalenceKey: 'source-c' },
    ];

    const first = selectCompleteEquivalenceBatch(rows, 3);
    const second = selectCompleteEquivalenceBatch(
      rows.filter((row) => !first.rows.some((selected) => selected.id === row.id)),
      3,
    );

    expect(first.rows.map((row) => row.id)).toEqual(['n_01', 'n_03']);
    expect(first.equivalenceKeys).toEqual(['source-a']);
    expect(first.oversized).toBe(false);
    expect(second.rows.map((row) => row.id)).toEqual(['n_02', 'n_04', 'n_05']);
    expect(second.equivalenceKeys).toEqual(['source-b', 'source-c']);
  });

  it('keeps an oversized equivalence group intact and reports the soft-bound exception', () => {
    const rows = ['n_01', 'n_02', 'n_03'].map((id) => ({ id, equivalenceKey: 'source-a' }));

    const batch = selectCompleteEquivalenceBatch(rows, 2);

    expect(batch.rows).toHaveLength(3);
    expect(batch.oversized).toBe(true);
  });

  it('prefers an existing source link and otherwise the earliest creation time and id', () => {
    const existing = recipient('n_30', { sourceEventId: 'src_1', createdAt: march });
    const earlyB = recipient('n_20', { createdAt: january });
    const earlyA = recipient('n_10', { createdAt: january });

    expect(selectLegacyRecipientSurvivor([earlyB, existing, earlyA]).id).toBe('n_30');
    expect(selectLegacyRecipientSurvivor([earlyB, earlyA]).id).toBe('n_10');
  });

  it('folds visibility, dismissal, snooze, unread anchors, and confirmed channels', () => {
    const now = february;
    const folded = foldLegacyRecipientGroup(
      [
        recipient('n_01', {
          dismissedAt: january,
          readAt: null,
          deliveredChannels: ['inbox', 'slack_dm'],
        }),
        recipient('n_02', {
          readAt: null,
          manualUnreadAnchor: true,
          snoozedUntil: april,
          deliveredChannels: ['email', 'inbox'],
        }),
        recipient('n_03', {
          readAt: null,
          snoozedUntil: march,
          deliveredChannels: ['inbox'],
        }),
      ],
      now,
    );

    expect(folded).toEqual({
      surfaceInInbox: true,
      dismissedAt: null,
      snoozedUntil: march,
      readAt: null,
      manualUnreadAnchor: false,
      deliveredChannels: ['email', 'inbox', 'slack_dm'],
    });
  });

  it('does not surface provider-only history and requires every active sibling to be snoozed', () => {
    const folded = foldLegacyRecipientGroup(
      [
        recipient('n_01', {
          deliveredChannels: ['email'],
          snoozedUntil: april,
        }),
        recipient('n_02', {
          deliveredChannels: ['slack_dm'],
          snoozedUntil: null,
        }),
      ],
      february,
    );

    expect(folded.surfaceInInbox).toBe(false);
    expect(folded.snoozedUntil).toBeNull();
  });

  it('chooses a confirmed provider send before retryable and terminal rows', () => {
    const result = classifyLegacyDeliveryGroup(
      [
        delivery('d_01', 'failed'),
        delivery('d_02', 'succeeded', { deliveredAt: march, createdAt: february }),
        delivery('d_03', 'succeeded', { deliveredAt: february, createdAt: march }),
        delivery('d_04', 'dead_letter'),
      ],
      april,
    );

    expect(result).toEqual({
      kind: 'classified',
      survivorId: 'd_03',
      duplicateUpdates: [
        {
          id: 'd_01',
          status: 'unavailable',
          lastError: 'legacy duplicate delivery',
        },
        { id: 'd_02', status: 'succeeded', lastError: null },
        {
          id: 'd_04',
          status: 'unavailable',
          lastError: 'legacy duplicate delivery',
        },
      ],
    });
  });

  it('keeps one definitively unsent retry and blocks unresolved provider uncertainty', () => {
    const eligible = classifyLegacyDeliveryGroup(
      [
        delivery('d_02', 'failed', { createdAt: february }),
        delivery('d_01', 'pending'),
        delivery('d_03', 'unavailable'),
      ],
      april,
    );
    const uncertain = classifyLegacyDeliveryGroup(
      [
        delivery('d_01', 'pending', { providerMessageTs: '1700000000.000100' }),
        delivery('d_02', 'failed', { sendStartedAt: january }),
      ],
      april,
    );

    expect(eligible.kind).toBe('classified');
    if (eligible.kind === 'classified') expect(eligible.survivorId).toBe('d_01');
    expect(uncertain).toEqual({ kind: 'blocked', blockingIds: ['d_01', 'd_02'] });
  });

  it('classifies a complete exact-source group and reparents its confirmed delivery survivor', async () => {
    const suffix = randomUUIDv7();
    const organizationId = `org_exact_${suffix}`;
    const userId = `usr_exact_${suffix}`;
    const integrationId = `int_exact_${suffix}`;
    const firstId = `ntf_exact_a_${suffix}`;
    const secondId = `ntf_exact_b_${suffix}`;
    const pendingDeliveryId = `ndl_exact_a_${suffix}`;
    const sentDeliveryId = `ndl_exact_b_${suffix}`;
    await db.insert(organization).values({
      id: organizationId,
      name: 'Exact backfill test',
      slug: `exact-${suffix.toLowerCase()}`,
    });
    await db.insert(user).values({
      id: userId,
      name: 'Exact backfill user',
      email: `exact.${suffix}@orbit.local`,
      handle: `exact-${suffix.toLowerCase()}`,
    });
    await db.insert(integration).values({
      id: integrationId,
      organizationId,
      provider: 'slack',
      externalId: `T-${suffix}`,
      connectedById: userId,
      credentials: { botToken: 'test' },
      config: {},
    });

    try {
      await db.insert(notification).values([
        {
          id: firstId,
          organizationId,
          userId,
          type: 'mention',
          reason: 'mentioned',
          actorId: userId,
          actorName: 'Exact backfill user',
          entityType: 'issue',
          entityId: 'iss_exact',
          title: 'First exact event',
          body: 'First body',
          url: '/issues/iss_exact',
          deliveredChannels: ['inbox', 'slack_dm'],
          readAt: null,
          snoozedUntil: march,
          createdAt: january,
        },
        {
          id: secondId,
          organizationId,
          userId,
          type: 'mention',
          reason: 'mentioned',
          actorId: userId,
          actorName: 'Exact backfill user',
          entityType: 'issue',
          entityId: 'iss_exact',
          title: 'Second exact event',
          body: 'Second body',
          url: '/issues/iss_exact',
          deliveredChannels: ['email', 'inbox'],
          readAt: null,
          manualUnreadAnchor: true,
          snoozedUntil: april,
          createdAt: february,
        },
      ]);
      await db.insert(notificationDelivery).values([
        {
          id: pendingDeliveryId,
          notificationId: firstId,
          organizationId,
          userId,
          channel: 'slack_dm',
          integrationId,
          status: 'failed',
          availableAt: january,
          createdAt: january,
        },
        {
          id: sentDeliveryId,
          notificationId: secondId,
          organizationId,
          userId,
          channel: 'slack_dm',
          integrationId,
          status: 'succeeded',
          deliveredAt: february,
          providerMessageChannel: 'D123',
          providerMessageTs: '1700000000.000100',
          createdAt: february,
        },
      ]);

      await runNotificationConversationBackfill(db, {
        organizationIds: [organizationId],
        batchSize: 1,
        now: february,
        resolveLegacySource: (_database, input) =>
          Promise.resolve({
            sourceEventKey: 'exact-source:comment-1',
            equivalentNotificationIds: [firstId, secondId],
            subjectType: 'issue',
            subjectKey: 'orbit-issue:iss_exact:activity',
            occurredAt: input.createdAt,
          }),
      });
      const events = await db
        .select()
        .from(notification)
        .where(eq(notification.organizationId, organizationId));
      const deliveries = await db
        .select()
        .from(notificationDelivery)
        .where(eq(notificationDelivery.organizationId, organizationId));
      const [conversation] = await db
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.organizationId, organizationId));
      const survivor = events.find((event) => event.id === firstId);
      const duplicate = events.find((event) => event.id === secondId);
      const canonicalDelivery = deliveries.find((delivery) => delivery.id === sentDeliveryId);
      const auditDelivery = deliveries.find((delivery) => delivery.id === pendingDeliveryId);
      const verification = await verifyNotificationConversationBackfill(db, {
        organizationIds: [organizationId],
        now: february,
      });

      expect(survivor).toMatchObject({
        sourceEventId: expect.any(String),
        surfaceInInbox: true,
        readAt: null,
        manualUnreadAnchor: false,
        deliveredChannels: ['email', 'inbox', 'slack_dm'],
      });
      expect(duplicate).toMatchObject({
        sourceEventId: null,
        conversationId: null,
        surfaceInInbox: false,
        deduplicatedIntoNotificationId: firstId,
      });
      expect(canonicalDelivery).toMatchObject({
        notificationId: firstId,
        sourceEventId: survivor?.sourceEventId,
        conversationKey: 'orbit-issue:iss_exact:activity',
        deduplicatedIntoDeliveryId: null,
        status: 'succeeded',
      });
      expect(auditDelivery).toMatchObject({
        notificationId: secondId,
        sourceEventId: null,
        deduplicatedIntoDeliveryId: sentDeliveryId,
        status: 'unavailable',
        lastError: 'legacy duplicate delivery',
      });
      expect(conversation).toMatchObject({
        eventCount: 1,
        unreadEventCount: 1,
        unreadMentionCount: 1,
        manualUnread: false,
        snoozedUntil: march,
      });
      expect(verification.ok).toBe(true);
    } finally {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });
});

class MemoryBackfillStore implements ConversationBackfillStore {
  readonly progress = new Map<string, ConversationBackfillProgress>();
  readonly calls: string[] = [];
  failAfterFirstBatch = false;
  private failed = false;

  constructor(
    private readonly organizationIds: readonly string[],
    private readonly batches: ReadonlyMap<string, readonly ConversationBackfillBatchResult[]>,
  ) {}

  listOrganizationIds(): Promise<readonly string[]> {
    return Promise.resolve(this.organizationIds);
  }

  readProgress(
    organizationId: string,
    phase: ConversationBackfillPhase,
  ): Promise<ConversationBackfillProgress | null> {
    return Promise.resolve(this.progress.get(`${organizationId}:${phase}`) ?? null);
  }

  writeProgress(progress: ConversationBackfillProgress): Promise<void> {
    this.progress.set(`${progress.organizationId}:${progress.phase}`, progress);
    return Promise.resolve();
  }

  processBatch(input: {
    readonly organizationId: string;
    readonly phase: ConversationBackfillPhase;
    readonly cursor: string | null;
    readonly batchSize: number;
    readonly now: Date;
  }): Promise<ConversationBackfillBatchResult> {
    const key = `${input.organizationId}:${input.phase}`;
    const available = this.batches.get(key) ?? [];
    const previousIndex = available.findIndex((batch) => batch.cursor === input.cursor);
    const batchIndex = input.cursor === null ? 0 : previousIndex + 1;
    this.calls.push(key);
    if (this.failAfterFirstBatch && this.calls.length > 1 && !this.failed) {
      this.failed = true;
      return Promise.reject(new Error('injected failure'));
    }
    return Promise.resolve(
      available[batchIndex] ?? { processedRows: 0, cursor: input.cursor, done: true },
    );
  }
}

describe('resumable conversation backfill', () => {
  it('persists each organization cursor and resumes a failed phase without replaying completed work', async () => {
    const batches = new Map<string, readonly ConversationBackfillBatchResult[]>([
      [
        'org_a:sources',
        [
          { processedRows: 2, cursor: 'n_02', done: false },
          { processedRows: 1, cursor: 'n_03', done: true },
        ],
      ],
      ['org_a:recipients', [{ processedRows: 0, cursor: null, done: true }]],
      ['org_a:deliveries', [{ processedRows: 0, cursor: null, done: true }]],
      ['org_a:conversations', [{ processedRows: 1, cursor: 'n_03', done: true }]],
      ['org_a:tail', [{ processedRows: 0, cursor: null, done: true }]],
      ['org_b:sources', [{ processedRows: 1, cursor: 'n_01', done: true }]],
      ['org_b:recipients', [{ processedRows: 0, cursor: null, done: true }]],
      ['org_b:deliveries', [{ processedRows: 0, cursor: null, done: true }]],
      ['org_b:conversations', [{ processedRows: 1, cursor: 'n_01', done: true }]],
      ['org_b:tail', [{ processedRows: 0, cursor: null, done: true }]],
    ]);
    const store = new MemoryBackfillStore(['org_b', 'org_a'], batches);
    store.failAfterFirstBatch = true;

    await expect(
      runResumableConversationBackfill(store, { batchSize: 2, now: april }),
    ).rejects.toThrow('injected failure');

    expect(store.progress.get('org_a:sources')).toMatchObject({
      cursor: 'n_02',
      status: 'failed',
      processedRows: 2,
      lastError: 'injected failure',
    });

    store.failAfterFirstBatch = false;
    const result = await runResumableConversationBackfill(store, { batchSize: 2, now: april });

    expect(result.organizations.map((organization) => organization.organizationId)).toEqual([
      'org_a',
      'org_b',
    ]);
    expect(store.progress.get('org_a:sources')).toMatchObject({
      cursor: 'n_03',
      status: 'completed',
      processedRows: 3,
      lastError: null,
    });
    expect(store.progress.get('org_b:sources')).toMatchObject({
      status: 'completed',
      processedRows: 1,
    });
  });

  it('materializes one conservative legacy source, conversation, counters, and completed progress', async () => {
    const suffix = randomUUIDv7();
    const organizationId = `org_backfill_${suffix}`;
    const userId = `usr_backfill_${suffix}`;
    const notificationId = `ntf_backfill_${suffix}`;
    await db.insert(organization).values({
      id: organizationId,
      name: 'Backfill test',
      slug: `backfill-${suffix.toLowerCase()}`,
    });
    await db.insert(user).values({
      id: userId,
      name: 'Backfill user',
      email: `backfill.${suffix}@orbit.local`,
      handle: `backfill-${suffix.toLowerCase()}`,
    });

    try {
      await db.insert(notification).values({
        id: notificationId,
        organizationId,
        userId,
        type: 'comment_created',
        reason: 'commented',
        actorId: userId,
        actorName: 'Backfill user',
        entityType: 'issue',
        entityId: 'iss_backfill',
        title: 'A historical comment',
        body: 'Historical body',
        url: '/issues/iss_backfill',
        deliveredChannels: ['inbox'],
        readAt: null,
        createdAt: january,
      });

      const result = await runNotificationConversationBackfill(db, {
        organizationIds: [organizationId],
        batchSize: 2,
        now: april,
      });
      const [source] = await db
        .select()
        .from(notificationSourceEvent)
        .where(eq(notificationSourceEvent.organizationId, organizationId));
      const [event] = await db
        .select()
        .from(notification)
        .where(eq(notification.id, notificationId));
      const [conversation] = await db
        .select()
        .from(notificationConversation)
        .where(eq(notificationConversation.organizationId, organizationId));
      const [inboxState] = await db
        .select()
        .from(notificationInboxState)
        .where(eq(notificationInboxState.organizationId, organizationId));
      const progress = await db
        .select()
        .from(notificationConversationBackfillProgress)
        .where(eq(notificationConversationBackfillProgress.organizationId, organizationId));
      const verification = await verifyNotificationConversationBackfill(db, {
        organizationIds: [organizationId],
        now: april,
      });

      expect(result.organizations).toHaveLength(1);
      expect(source).toMatchObject({
        sourceEventKey: `legacy-notification:${notificationId}`,
        subjectType: 'issue',
        subjectKey: 'orbit-issue:iss_backfill:activity',
      });
      expect(source?.fanoutCompletedAt).not.toBeNull();
      expect(event).toMatchObject({
        sourceEventId: source?.id,
        conversationId: conversation?.id,
        surfaceInInbox: true,
        deduplicatedIntoNotificationId: null,
      });
      expect(conversation).toMatchObject({
        conversationKey: 'orbit-issue:iss_backfill:activity',
        eventCount: 1,
        unreadEventCount: 1,
        manualUnread: false,
      });
      expect(inboxState).toMatchObject({
        unreadCount: 1,
        unreadActivityCount: 1,
        unreadMentionCount: 0,
      });
      expect(progress).toHaveLength(5);
      expect(progress.every((row) => row.status === 'completed')).toBe(true);
      expect(verification.ok).toBe(true);
    } finally {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
    }
  });
});
