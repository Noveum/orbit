import type { Database, Transaction } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { sql } from 'drizzle-orm';
import {
  type NotificationConversationIdentity,
  resolveNotificationConversation,
} from './conversations.ts';

export type NotificationConversationBackfillDatabase = Database | Transaction;

export interface CompleteEquivalenceRow {
  readonly id: string;
  readonly equivalenceKey: string;
}

export interface CompleteEquivalenceBatch<Row extends CompleteEquivalenceRow> {
  readonly rows: readonly Row[];
  readonly equivalenceKeys: readonly string[];
  readonly oversized: boolean;
}

export interface LegacyRecipientCandidate {
  readonly id: string;
  readonly sourceEventId: string | null;
  readonly createdAt: Date;
  readonly deliveredChannels: readonly string[];
  readonly readAt: Date | null;
  readonly snoozedUntil: Date | null;
  readonly dismissedAt: Date | null;
  readonly manualUnreadAnchor: boolean;
  readonly surfaceInInbox: boolean | null;
}

export interface FoldedLegacyRecipientState {
  readonly surfaceInInbox: boolean;
  readonly dismissedAt: Date | null;
  readonly snoozedUntil: Date | null;
  readonly readAt: Date | null;
  readonly manualUnreadAnchor: boolean;
  readonly deliveredChannels: readonly string[];
}

export interface LegacyDeliveryCandidate {
  readonly id: string;
  readonly status: string;
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
  readonly availableAt: Date;
  readonly claimedAt: Date | null;
  readonly sendStartedAt: Date | null;
  readonly providerMessageId: string | null;
  readonly providerMessageChannel: string | null;
  readonly providerMessageTs: string | null;
}

export interface LegacyDeliveryDuplicateUpdate {
  readonly id: string;
  readonly status: string;
  readonly lastError: string | null;
}

export type LegacyDeliveryClassification =
  | {
      readonly kind: 'classified';
      readonly survivorId: string;
      readonly duplicateUpdates: readonly LegacyDeliveryDuplicateUpdate[];
    }
  | {
      readonly kind: 'blocked';
      readonly blockingIds: readonly string[];
    };

export const CONVERSATION_BACKFILL_PHASES = [
  'sources',
  'recipients',
  'deliveries',
  'conversations',
  'tail',
] as const;

export type ConversationBackfillPhase = (typeof CONVERSATION_BACKFILL_PHASES)[number];
export type ConversationBackfillStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ConversationBackfillProgress {
  readonly organizationId: string;
  readonly phase: ConversationBackfillPhase;
  readonly cursor: string | null;
  readonly highWaterMark: string | null;
  readonly status: ConversationBackfillStatus;
  readonly processedRows: number;
  readonly passNumber: number;
  readonly startedAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly lastError: string | null;
}

export interface ConversationBackfillBatchInput {
  readonly organizationId: string;
  readonly phase: ConversationBackfillPhase;
  readonly cursor: string | null;
  readonly batchSize: number;
  readonly now: Date;
}

export interface ConversationBackfillBatchResult {
  readonly processedRows: number;
  readonly cursor: string | null;
  readonly highWaterMark?: string | null;
  readonly passNumber?: number;
  readonly done: boolean;
}

export interface ConversationBackfillStore {
  listOrganizationIds(): Promise<readonly string[]>;
  readProgress(
    organizationId: string,
    phase: ConversationBackfillPhase,
  ): Promise<ConversationBackfillProgress | null>;
  writeProgress(progress: ConversationBackfillProgress): Promise<void>;
  processBatch(input: ConversationBackfillBatchInput): Promise<ConversationBackfillBatchResult>;
}

export interface ResumableConversationBackfillOptions {
  readonly batchSize?: number;
  readonly now?: Date;
  readonly organizationIds?: readonly string[];
  readonly phases?: readonly ConversationBackfillPhase[];
  readonly maxBatches?: number;
}

export interface LegacyNotificationSourceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly type: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly url: string;
  readonly createdAt: Date;
}

export interface LegacyNotificationSourceResolution {
  readonly sourceEventKey: string;
  readonly equivalentNotificationIds: readonly string[];
  readonly subjectType: string;
  readonly subjectKey: string;
  readonly occurredAt: Date;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly sourceDeliveryId?: string;
}

export type ResolveLegacyNotificationSource = (
  database: NotificationConversationBackfillDatabase,
  input: LegacyNotificationSourceInput,
) => Promise<LegacyNotificationSourceResolution>;

export interface NotificationConversationBackfillOptions
  extends ResumableConversationBackfillOptions {
  readonly resolveLegacySource?: ResolveLegacyNotificationSource;
  readonly maxEquivalenceGroupRows?: number;
}

export interface ConversationBackfillOrganizationResult {
  readonly organizationId: string;
  readonly phases: readonly ConversationBackfillProgress[];
}

export interface ConversationBackfillRunResult {
  readonly organizations: readonly ConversationBackfillOrganizationResult[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function timestampMillis(value: Date | string): number {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Database timestamp is invalid.');
  return milliseconds;
}

function compareDates(left: Date | string, right: Date | string): number {
  return timestampMillis(left) - timestampMillis(right);
}

function timestampDate(value: Date | string): Date {
  return new Date(timestampMillis(value));
}

function postgresTimestamp(value: Date | string | null): string | null {
  return value === null ? null : new Date(timestampMillis(value)).toISOString();
}

function latestDate(values: readonly Date[]): Date | null {
  if (values.length === 0) return null;
  return [...values].sort(compareDates).at(-1) ?? null;
}

function earliestDate(values: readonly Date[]): Date | null {
  if (values.length === 0) return null;
  return [...values].sort(compareDates)[0] ?? null;
}

function isSurfaced(row: LegacyRecipientCandidate): boolean {
  return row.surfaceInInbox ?? row.deliveredChannels.includes('inbox');
}

export function selectCompleteEquivalenceBatch<Row extends CompleteEquivalenceRow>(
  input: readonly Row[],
  limit: number,
): CompleteEquivalenceBatch<Row> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Backfill batch size must be positive.');

  const ids = new Set<string>();
  const grouped = new Map<string, Row[]>();
  for (const row of input) {
    if (ids.has(row.id)) throw new Error(`Duplicate backfill row id ${row.id}.`);
    ids.add(row.id);
    const members = grouped.get(row.equivalenceKey) ?? [];
    members.push(row);
    grouped.set(row.equivalenceKey, members);
  }

  const groups = [...grouped.entries()]
    .map(([equivalenceKey, rows]) => ({
      equivalenceKey,
      rows: [...rows].sort((left, right) => compareText(left.id, right.id)),
    }))
    .sort((left, right) => {
      const byFirstId = compareText(left.rows[0]?.id ?? '', right.rows[0]?.id ?? '');
      return byFirstId === 0 ? compareText(left.equivalenceKey, right.equivalenceKey) : byFirstId;
    });

  const selected: Row[] = [];
  const equivalenceKeys: string[] = [];
  for (const group of groups) {
    if (selected.length > 0 && selected.length + group.rows.length > limit) break;
    selected.push(...group.rows);
    equivalenceKeys.push(group.equivalenceKey);
    if (selected.length >= limit) break;
  }

  return {
    rows: selected,
    equivalenceKeys,
    oversized: selected.length > limit,
  };
}

export function selectLegacyRecipientSurvivor<Row extends LegacyRecipientCandidate>(
  rows: readonly Row[],
): Row {
  if (rows.length === 0) throw new Error('A recipient equivalence group cannot be empty.');
  const ordered = [...rows].sort((left, right) => {
    const byCreation = compareDates(left.createdAt, right.createdAt);
    return byCreation === 0 ? compareText(left.id, right.id) : byCreation;
  });
  const fallback = ordered[0];
  if (fallback === undefined) throw new Error('A recipient equivalence group cannot be empty.');
  return ordered.find((row) => row.sourceEventId !== null) ?? fallback;
}

export function foldLegacyRecipientGroup(
  rows: readonly LegacyRecipientCandidate[],
  now: Date,
): FoldedLegacyRecipientState {
  if (rows.length === 0) throw new Error('A recipient equivalence group cannot be empty.');
  const surfaced = rows.filter(isSurfaced);
  const active = surfaced.filter((row) => row.dismissedAt === null);
  const dismissedAt =
    surfaced.length > 0 && active.length === 0
      ? latestDate(surfaced.flatMap((row) => (row.dismissedAt === null ? [] : [row.dismissedAt])))
      : null;
  const futureSnoozes = active.flatMap((row) =>
    row.snoozedUntil !== null && timestampMillis(row.snoozedUntil) > timestampMillis(now)
      ? [row.snoozedUntil]
      : [],
  );
  const snoozedUntil =
    active.length > 0 && futureSnoozes.length === active.length
      ? earliestDate(futureSnoozes)
      : null;
  const realUnread = active.some((row) => row.readAt === null && !row.manualUnreadAnchor);
  const manualUnread = active.some((row) => row.readAt === null && row.manualUnreadAnchor);
  const readAt =
    realUnread || manualUnread
      ? null
      : latestDate((active.length > 0 ? active : surfaced).flatMap((row) => row.readAt ?? []));
  const deliveredChannels = [...new Set(rows.flatMap((row) => [...row.deliveredChannels]))].sort(
    compareText,
  );

  return {
    surfaceInInbox: surfaced.length > 0,
    dismissedAt,
    snoozedUntil,
    readAt,
    manualUnreadAnchor: !realUnread && manualUnread,
    deliveredChannels,
  };
}

const CONFIRMED_DELIVERY_STATUSES = new Set(['delivered', 'sent', 'succeeded']);
const UNCERTAIN_DELIVERY_STATUSES = new Set(['ambiguous', 'processing']);
const RETRYABLE_DELIVERY_STATUSES = new Set(['failed', 'pending']);
const TERMINAL_DELIVERY_PRIORITY = new Map([
  ['dead_letter', 0],
  ['unavailable', 1],
  ['skipped', 1],
]);

function isDeliveryUncertain(row: LegacyDeliveryCandidate): boolean {
  if (UNCERTAIN_DELIVERY_STATUSES.has(row.status)) return true;
  return (
    RETRYABLE_DELIVERY_STATUSES.has(row.status) &&
    (row.claimedAt !== null ||
      row.sendStartedAt !== null ||
      row.providerMessageId !== null ||
      row.providerMessageChannel !== null ||
      row.providerMessageTs !== null)
  );
}

function compareDeliveryAge(left: LegacyDeliveryCandidate, right: LegacyDeliveryCandidate): number {
  const byCreation = compareDates(left.createdAt, right.createdAt);
  return byCreation === 0 ? compareText(left.id, right.id) : byCreation;
}

function compareConfirmedDeliveries(
  left: LegacyDeliveryCandidate,
  right: LegacyDeliveryCandidate,
): number {
  if (left.deliveredAt !== null && right.deliveredAt !== null) {
    const byDelivery = compareDates(left.deliveredAt, right.deliveredAt);
    if (byDelivery !== 0) return byDelivery;
  } else if (left.deliveredAt !== null) return -1;
  else if (right.deliveredAt !== null) return 1;
  return compareDeliveryAge(left, right);
}

export function classifyLegacyDeliveryGroup(
  rows: readonly LegacyDeliveryCandidate[],
  now: Date,
): LegacyDeliveryClassification {
  if (rows.length === 0) throw new Error('A delivery equivalence group cannot be empty.');
  const blockingIds = rows
    .filter(isDeliveryUncertain)
    .map((row) => row.id)
    .sort(compareText);
  if (blockingIds.length > 0) return { kind: 'blocked', blockingIds };

  const confirmed = rows
    .filter((row) => CONFIRMED_DELIVERY_STATUSES.has(row.status))
    .sort(compareConfirmedDeliveries);
  const eligible = rows
    .filter(
      (row) =>
        RETRYABLE_DELIVERY_STATUSES.has(row.status) &&
        timestampMillis(row.availableAt) <= timestampMillis(now),
    )
    .sort(compareDeliveryAge);
  const terminal = rows
    .filter((row) => TERMINAL_DELIVERY_PRIORITY.has(row.status))
    .sort((left, right) => {
      const byStatus =
        (TERMINAL_DELIVERY_PRIORITY.get(left.status) ?? Number.MAX_SAFE_INTEGER) -
        (TERMINAL_DELIVERY_PRIORITY.get(right.status) ?? Number.MAX_SAFE_INTEGER);
      return byStatus === 0 ? compareDeliveryAge(left, right) : byStatus;
    });
  const survivor = confirmed[0] ?? eligible[0] ?? terminal[0];
  if (survivor === undefined) {
    return { kind: 'blocked', blockingIds: rows.map((row) => row.id).sort(compareText) };
  }

  const duplicateUpdates = rows
    .filter((row) => row.id !== survivor.id)
    .sort((left, right) => compareText(left.id, right.id))
    .map((row) =>
      RETRYABLE_DELIVERY_STATUSES.has(row.status) || row.status === 'dead_letter'
        ? {
            id: row.id,
            status: 'unavailable',
            lastError: 'legacy duplicate delivery',
          }
        : { id: row.id, status: row.status, lastError: null },
    );
  return { kind: 'classified', survivorId: survivor.id, duplicateUpdates };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateBackfillOptions(options: ResumableConversationBackfillOptions): {
  readonly batchSize: number;
  readonly maxBatches: number;
} {
  const batchSize = options.batchSize ?? 500;
  const maxBatches = options.maxBatches ?? 1_000_000;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Backfill batch size must be positive.');
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error('Backfill maximum batch count must be positive.');
  }
  return { batchSize, maxBatches };
}

export async function runResumableConversationBackfill(
  store: ConversationBackfillStore,
  options: ResumableConversationBackfillOptions = {},
): Promise<ConversationBackfillRunResult> {
  const { batchSize, maxBatches } = validateBackfillOptions(options);
  const now = options.now ?? new Date();
  const availableOrganizations = await store.listOrganizationIds();
  const requested = options.organizationIds ?? availableOrganizations;
  const organizations = [...new Set(requested)].sort(compareText);
  const phases = options.phases ?? CONVERSATION_BACKFILL_PHASES;
  const results: ConversationBackfillOrganizationResult[] = [];
  let batchCount = 0;

  for (const organizationId of organizations) {
    const organization = await runBackfillOrganization(store, {
      organizationId,
      phases,
      batchSize,
      maxBatches,
      batchCount,
      now,
    });
    batchCount = organization.batchCount;
    results.push({ organizationId, phases: organization.phases });
  }

  return { organizations: results };
}

interface BackfillRunContext {
  readonly organizationId: string;
  readonly phases: readonly ConversationBackfillPhase[];
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly batchCount: number;
  readonly now: Date;
}

function runningProgress(
  organizationId: string,
  phase: ConversationBackfillPhase,
  previous: ConversationBackfillProgress | null,
  now: Date,
): ConversationBackfillProgress {
  return {
    organizationId,
    phase,
    cursor: previous?.cursor ?? null,
    highWaterMark: previous?.highWaterMark ?? null,
    status: 'running',
    processedRows: previous?.processedRows ?? 0,
    passNumber: previous?.passNumber ?? 1,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    completedAt: null,
    lastError: null,
  };
}

function progressAfterBatch(
  current: ConversationBackfillProgress,
  batch: ConversationBackfillBatchResult,
  now: Date,
): ConversationBackfillProgress {
  return {
    ...current,
    cursor: batch.cursor,
    highWaterMark: batch.highWaterMark ?? current.highWaterMark,
    status: batch.done ? 'completed' : 'running',
    processedRows: current.processedRows + batch.processedRows,
    passNumber: batch.passNumber ?? current.passNumber,
    updatedAt: now,
    completedAt: batch.done ? now : null,
    lastError: null,
  };
}

async function runBackfillPhase(
  store: ConversationBackfillStore,
  context: BackfillRunContext,
  phase: ConversationBackfillPhase,
): Promise<{ readonly progress: ConversationBackfillProgress; readonly batchCount: number }> {
  const previous = await store.readProgress(context.organizationId, phase);
  if (previous?.status === 'completed') {
    return { progress: previous, batchCount: context.batchCount };
  }
  let current = runningProgress(context.organizationId, phase, previous, context.now);
  let batchCount = context.batchCount;
  await store.writeProgress(current);
  try {
    while (current.status !== 'completed') {
      batchCount += 1;
      if (batchCount > context.maxBatches) {
        throw new Error('Backfill maximum batch count exceeded.');
      }
      const batch = await store.processBatch({
        organizationId: context.organizationId,
        phase,
        cursor: current.cursor,
        batchSize: context.batchSize,
        now: context.now,
      });
      current = progressAfterBatch(current, batch, context.now);
      await store.writeProgress(current);
    }
    return { progress: current, batchCount };
  } catch (error) {
    const failed = {
      ...current,
      status: 'failed' as const,
      updatedAt: context.now,
      completedAt: null,
      lastError: errorMessage(error),
    };
    await store.writeProgress(failed);
    throw error;
  }
}

async function runBackfillOrganization(
  store: ConversationBackfillStore,
  context: BackfillRunContext,
): Promise<{
  readonly phases: readonly ConversationBackfillProgress[];
  readonly batchCount: number;
}> {
  const phases: ConversationBackfillProgress[] = [];
  let batchCount = context.batchCount;
  for (const phase of context.phases) {
    const result = await runBackfillPhase(store, { ...context, batchCount }, phase);
    phases.push(result.progress);
    batchCount = result.batchCount;
  }
  return { phases, batchCount };
}

interface BackfillProgressRow extends Record<string, unknown> {
  readonly organizationId: string;
  readonly phase: string;
  readonly cursor: string | null;
  readonly highWaterMark: string | null;
  readonly status: string;
  readonly processedRows: number;
  readonly passNumber: number;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly lastError: string | null;
}

interface LegacyNotificationRow extends LegacyRecipientCandidate, Record<string, unknown> {
  readonly organizationId: string;
  readonly userId: string;
  readonly type: string;
  readonly reason: string | null;
  readonly actorName: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly externalUrl: string | null;
  readonly conversationId: string | null;
  readonly occurredAt: Date | null;
  readonly ingestedAt: Date | null;
  readonly ingestionSeq: number | null;
  readonly deduplicatedIntoNotificationId: string | null;
}

interface SourceEventRow extends Record<string, unknown> {
  readonly id: string;
  readonly sourceEventKey: string;
  readonly subjectType: string;
  readonly subjectKey: string;
  readonly occurredAt: Date;
  readonly ingestedAt: Date;
  readonly ingestionSeq: number;
  readonly fanoutCompletedAt: Date | null;
}

interface LegacyDeliveryRow extends LegacyDeliveryCandidate, Record<string, unknown> {
  readonly notificationId: string | null;
  readonly organizationId: string | null;
  readonly sourceEventId: string | null;
  readonly userId: string | null;
  readonly channel: string;
  readonly conversationKey: string | null;
  readonly deduplicatedIntoDeliveryId: string | null;
  readonly destinationKind: string | null;
  readonly destinationId: string | null;
  readonly integrationId: string | null;
  readonly slackTeamId: string | null;
  readonly slackAppId: string | null;
  readonly claimToken: string | null;
  readonly leaseExpiresAt: Date | null;
}

interface SourceResolutionGroup {
  readonly resolution: LegacyNotificationSourceResolution;
  readonly seedIds: readonly string[];
}

function isBackfillPhase(value: string): value is ConversationBackfillPhase {
  return CONVERSATION_BACKFILL_PHASES.some((phase) => phase === value);
}

function isBackfillStatus(value: string): value is ConversationBackfillStatus {
  return value === 'pending' || value === 'running' || value === 'completed' || value === 'failed';
}

function progressFromRow(row: BackfillProgressRow): ConversationBackfillProgress {
  if (!isBackfillPhase(row.phase))
    throw new Error(`Unknown conversation backfill phase ${row.phase}.`);
  if (!isBackfillStatus(row.status)) {
    throw new Error(`Unknown conversation backfill status ${row.status}.`);
  }
  return {
    organizationId: row.organizationId,
    phase: row.phase,
    cursor: row.cursor,
    highWaterMark: row.highWaterMark,
    status: row.status,
    processedRows: row.processedRows,
    passNumber: row.passNumber,
    startedAt: timestampDate(row.startedAt ?? row.updatedAt),
    updatedAt: timestampDate(row.updatedAt),
    completedAt: row.completedAt === null ? null : timestampDate(row.completedAt),
    lastError: row.lastError,
  };
}

function sqlList(values: readonly string[]) {
  if (values.length === 0) throw new Error('A SQL id list cannot be empty.');
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

function validateSourceResolution(
  seedId: string,
  resolution: LegacyNotificationSourceResolution,
  maxEquivalenceGroupRows: number,
): LegacyNotificationSourceResolution {
  if (resolution.sourceEventKey.trim().length === 0) throw new Error('Source event key is empty.');
  if (resolution.subjectType.trim().length === 0) throw new Error('Source subject type is empty.');
  if (resolution.subjectKey.trim().length === 0) throw new Error('Source subject key is empty.');
  const memberIds = [...new Set(resolution.equivalentNotificationIds)].sort(compareText);
  if (!memberIds.includes(seedId)) {
    throw new Error(`Source resolution for ${seedId} omitted its seed row.`);
  }
  if (memberIds.length > maxEquivalenceGroupRows) {
    throw new Error(
      `Source equivalence group ${resolution.sourceEventKey} exceeds ${maxEquivalenceGroupRows} rows.`,
    );
  }
  return { ...resolution, equivalentNotificationIds: memberIds };
}

function defaultLegacySourceResolution(
  _database: NotificationConversationBackfillDatabase,
  input: LegacyNotificationSourceInput,
): Promise<LegacyNotificationSourceResolution> {
  const identity = resolveNotificationConversation({
    notificationId: input.id,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    url: input.url,
  });
  return Promise.resolve({
    sourceEventKey: `legacy-notification:${input.id}`,
    equivalentNotificationIds: [input.id],
    subjectType: identity.subjectType,
    subjectKey: identity.conversationKey,
    occurredAt: input.createdAt,
  });
}

function sameSourceResolution(
  left: LegacyNotificationSourceResolution,
  right: LegacyNotificationSourceResolution,
): boolean {
  return (
    left.sourceEventKey === right.sourceEventKey &&
    left.subjectType === right.subjectType &&
    left.subjectKey === right.subjectKey &&
    timestampMillis(left.occurredAt) === timestampMillis(right.occurredAt) &&
    left.equivalentNotificationIds.length === right.equivalentNotificationIds.length &&
    left.equivalentNotificationIds.every(
      (notificationId, index) => notificationId === right.equivalentNotificationIds[index],
    )
  );
}

function notificationSourceInput(row: LegacyNotificationRow): LegacyNotificationSourceInput {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    url: row.url,
    createdAt: timestampDate(row.createdAt),
  };
}

function groupByUser(rows: readonly LegacyNotificationRow[]): readonly LegacyNotificationRow[][] {
  const grouped = new Map<string, LegacyNotificationRow[]>();
  for (const row of rows) {
    const members = grouped.get(row.userId) ?? [];
    members.push(row);
    grouped.set(row.userId, members);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, members]) => members.sort((left, right) => compareText(left.id, right.id)));
}

function deliveryDestination(row: LegacyDeliveryRow): {
  readonly destinationKind: string;
  readonly destinationId: string;
} | null {
  if (row.destinationKind !== null && row.destinationId !== null) {
    return { destinationKind: row.destinationKind, destinationId: row.destinationId };
  }
  if (row.channel === 'slack_dm' && row.userId !== null) {
    return { destinationKind: 'user', destinationId: row.userId };
  }
  return null;
}

function deliveryEquivalenceKey(row: LegacyDeliveryRow): string | null {
  const destination = deliveryDestination(row);
  if (destination === null || row.integrationId === null) return null;
  return JSON.stringify([
    row.channel,
    row.integrationId,
    row.slackTeamId,
    row.slackAppId,
    destination.destinationKind,
    destination.destinationId,
  ]);
}

function deliveryCandidate(row: LegacyDeliveryRow): LegacyDeliveryCandidate {
  return {
    id: row.id,
    status: row.status,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    availableAt: row.availableAt,
    claimedAt: row.claimedAt,
    sendStartedAt: row.sendStartedAt,
    providerMessageId: row.providerMessageId,
    providerMessageChannel: row.providerMessageChannel,
    providerMessageTs: row.providerMessageTs,
  };
}

async function lockSourceEvent(
  tx: Transaction,
  organizationId: string,
  resolution: LegacyNotificationSourceResolution,
  now: Date,
): Promise<SourceEventRow> {
  const sourceId = randomUUIDv7();
  const payload = resolution.payload === undefined ? null : JSON.stringify(resolution.payload);
  await tx.execute(sql`
    insert into notification_source_event (
      id,
      organization_id,
      source_event_key,
      source_delivery_id,
      subject_type,
      subject_key,
      occurred_at,
      ingested_at,
      payload,
      created_at,
      updated_at
    ) values (
      ${sourceId},
      ${organizationId},
      ${resolution.sourceEventKey},
      ${resolution.sourceDeliveryId ?? null},
      ${resolution.subjectType},
      ${resolution.subjectKey},
      ${postgresTimestamp(resolution.occurredAt)},
      ${postgresTimestamp(resolution.occurredAt)},
      ${payload}::jsonb,
      ${postgresTimestamp(now)},
      ${postgresTimestamp(now)}
    )
    on conflict (organization_id, source_event_key) do nothing
  `);
  const rows = await tx.execute<SourceEventRow>(sql`
    select
      id,
      source_event_key as "sourceEventKey",
      subject_type as "subjectType",
      subject_key as "subjectKey",
      occurred_at as "occurredAt",
      ingested_at as "ingestedAt",
      ingestion_seq::float8 as "ingestionSeq",
      fanout_completed_at as "fanoutCompletedAt"
    from notification_source_event
    where organization_id = ${organizationId}
      and source_event_key = ${resolution.sourceEventKey}
    for update
  `);
  const source = rows[0];
  if (source === undefined)
    throw new Error(`Failed to create source ${resolution.sourceEventKey}.`);
  if (
    source.subjectType !== resolution.subjectType ||
    source.subjectKey !== resolution.subjectKey ||
    timestampMillis(source.occurredAt) !== timestampMillis(resolution.occurredAt)
  ) {
    throw new Error(`Source identity conflict for ${resolution.sourceEventKey}.`);
  }
  return source;
}

async function lockLegacyNotifications(
  tx: Transaction,
  organizationId: string,
  notificationIds: readonly string[],
): Promise<readonly LegacyNotificationRow[]> {
  const rows = await tx.execute<LegacyNotificationRow>(sql`
    select
      id,
      organization_id as "organizationId",
      user_id as "userId",
      type,
      reason,
      actor_name as "actorName",
      entity_type as "entityType",
      entity_id as "entityId",
      title,
      body,
      url,
      external_url as "externalUrl",
      source_event_id as "sourceEventId",
      conversation_id as "conversationId",
      occurred_at as "occurredAt",
      ingested_at as "ingestedAt",
      ingestion_seq::float8 as "ingestionSeq",
      surface_in_inbox as "surfaceInInbox",
      read_at as "readAt",
      snoozed_until as "snoozedUntil",
      dismissed_at as "dismissedAt",
      manual_unread_anchor as "manualUnreadAnchor",
      deduplicated_into_notification_id as "deduplicatedIntoNotificationId",
      delivered_channels as "deliveredChannels",
      created_at as "createdAt"
    from notification
    where organization_id = ${organizationId}
      and id in (${sqlList(notificationIds)})
    order by user_id, id
    for update
  `);
  if (rows.length !== notificationIds.length) {
    throw new Error('A source equivalence group contains a missing or cross-tenant notification.');
  }
  return rows;
}

async function classifyRecipientGroup(
  tx: Transaction,
  source: SourceEventRow,
  rows: readonly LegacyNotificationRow[],
  now: Date,
): Promise<{ readonly userId: string; readonly survivorId: string }> {
  const survivor = selectLegacyRecipientSurvivor(rows);
  if (survivor.sourceEventId !== null && survivor.sourceEventId !== source.id) {
    throw new Error(`Recipient ${survivor.id} is linked to another source.`);
  }
  const folded = foldLegacyRecipientGroup(rows, now);
  const duplicates = rows
    .filter((row) => row.id !== survivor.id)
    .sort((left, right) => compareText(left.id, right.id));

  for (const duplicate of duplicates) {
    if (duplicate.sourceEventId !== null && duplicate.sourceEventId !== source.id) {
      throw new Error(`Recipient ${duplicate.id} is linked to another source.`);
    }
    await tx.execute(sql`
      update notification
      set
        source_event_id = null,
        conversation_id = null,
        surface_in_inbox = false,
        deduplicated_into_notification_id = ${survivor.id},
        sync_id = nextval('sync_id_seq')
      where organization_id = ${duplicate.organizationId}
        and user_id = ${duplicate.userId}
        and id = ${duplicate.id}
    `);
  }

  await tx.execute(sql`
    update notification
    set
      source_event_id = ${source.id},
      occurred_at = coalesce(occurred_at, ${postgresTimestamp(source.occurredAt)}),
      ingested_at = coalesce(ingested_at, ${postgresTimestamp(source.ingestedAt)}),
      ingestion_seq = coalesce(ingestion_seq, ${source.ingestionSeq}),
      surface_in_inbox = ${folded.surfaceInInbox},
      read_at = ${postgresTimestamp(folded.readAt)},
      snoozed_until = ${postgresTimestamp(folded.snoozedUntil)},
      dismissed_at = ${postgresTimestamp(folded.dismissedAt)},
      manual_unread_anchor = ${folded.manualUnreadAnchor},
      deduplicated_into_notification_id = null,
      delivered_channels = ${JSON.stringify(folded.deliveredChannels)}::jsonb,
      sync_id = nextval('sync_id_seq')
    where organization_id = ${survivor.organizationId}
      and user_id = ${survivor.userId}
      and id = ${survivor.id}
  `);
  return { userId: survivor.userId, survivorId: survivor.id };
}

async function lockLegacyDeliveries(
  tx: Transaction,
  organizationId: string,
  notificationIds: readonly string[],
  sourceDeliveryId: string | undefined,
): Promise<readonly LegacyDeliveryRow[]> {
  return await tx.execute<LegacyDeliveryRow>(sql`
    select
      id,
      notification_id as "notificationId",
      organization_id as "organizationId",
      source_event_id as "sourceEventId",
      user_id as "userId",
      channel,
      conversation_key as "conversationKey",
      deduplicated_into_delivery_id as "deduplicatedIntoDeliveryId",
      destination_kind as "destinationKind",
      destination_id as "destinationId",
      integration_id as "integrationId",
      slack_team_id as "slackTeamId",
      slack_app_id as "slackAppId",
      status,
      available_at as "availableAt",
      claim_token as "claimToken",
      claimed_at as "claimedAt",
      lease_expires_at as "leaseExpiresAt",
      send_started_at as "sendStartedAt",
      provider_message_id as "providerMessageId",
      provider_message_channel as "providerMessageChannel",
      provider_message_ts as "providerMessageTs",
      delivered_at as "deliveredAt",
      created_at as "createdAt"
    from notification_delivery
    where notification_id in (${sqlList(notificationIds)})
      ${
        sourceDeliveryId === undefined
          ? sql``
          : sql`or (organization_id = ${organizationId} and source_delivery_id = ${sourceDeliveryId})`
      }
    order by id
    for update
  `);
}

async function classifyDeliveryRows(
  tx: Transaction,
  organizationId: string,
  source: SourceEventRow,
  conversationKey: string,
  notificationSurvivors: ReadonlyMap<string, string>,
  rows: readonly LegacyDeliveryRow[],
  now: Date,
): Promise<void> {
  const grouped = new Map<string, LegacyDeliveryRow[]>();
  for (const row of rows) {
    if (row.deduplicatedIntoDeliveryId !== null) continue;
    const key = deliveryEquivalenceKey(row);
    if (key === null) throw new Error(`Delivery ${row.id} has no provable provider destination.`);
    const members = grouped.get(key) ?? [];
    members.push(row);
    grouped.set(key, members);
  }

  for (const [key, members] of [...grouped.entries()].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    await classifyDeliveryEquivalenceGroup({
      tx,
      organizationId,
      source,
      conversationKey,
      notificationSurvivors,
      key,
      members,
      now,
    });
  }
}

interface DeliveryClassificationContext {
  readonly tx: Transaction;
  readonly organizationId: string;
  readonly source: SourceEventRow;
  readonly conversationKey: string;
  readonly notificationSurvivors: ReadonlyMap<string, string>;
  readonly key: string;
  readonly members: readonly LegacyDeliveryRow[];
  readonly now: Date;
}

function canonicalNotificationForDelivery(
  canonical: LegacyDeliveryRow,
  notificationSurvivors: ReadonlyMap<string, string>,
): string | null {
  if (canonical.userId === null) return null;
  const notificationId = notificationSurvivors.get(canonical.userId);
  if (notificationId === undefined) {
    throw new Error(`Delivery ${canonical.id} has no recipient survivor.`);
  }
  return notificationId;
}

function deliveryDuplicateRows(
  members: readonly LegacyDeliveryRow[],
  updates: readonly LegacyDeliveryDuplicateUpdate[],
): readonly {
  readonly row: LegacyDeliveryRow;
  readonly update: LegacyDeliveryDuplicateUpdate;
}[] {
  return updates.map((update) => {
    const row = members.find((candidate) => candidate.id === update.id);
    if (row === undefined) throw new Error(`Delivery ${update.id} is missing.`);
    if (row.notificationId === null || row.userId === null) {
      throw new Error(`Shared delivery ${row.id} cannot be an audit duplicate.`);
    }
    return { row, update };
  });
}

async function classifyDeliveryEquivalenceGroup(
  context: DeliveryClassificationContext,
): Promise<void> {
  const classification = classifyLegacyDeliveryGroup(
    context.members.map(deliveryCandidate),
    context.now,
  );
  if (classification.kind === 'blocked') {
    throw new Error(
      `Delivery uncertainty blocks ${context.key}: ${classification.blockingIds.join(', ')}.`,
    );
  }
  const canonical = context.members.find((row) => row.id === classification.survivorId);
  if (canonical === undefined) throw new Error(`Delivery ${classification.survivorId} is missing.`);
  const destination = deliveryDestination(canonical);
  if (destination === null || canonical.integrationId === null) {
    throw new Error(`Delivery ${canonical.id} has no canonical provider destination.`);
  }
  const canonicalNotificationId = canonicalNotificationForDelivery(
    canonical,
    context.notificationSurvivors,
  );
  const duplicates = deliveryDuplicateRows(context.members, classification.duplicateUpdates).map(
    (duplicate) => {
      const finalNotificationId =
        duplicate.row.notificationId === canonicalNotificationId
          ? canonical.notificationId
          : duplicate.row.notificationId;
      if (finalNotificationId === null || finalNotificationId === canonicalNotificationId) {
        throw new Error(`Delivery ${duplicate.row.id} cannot retain a distinct audit owner.`);
      }
      return { ...duplicate, finalNotificationId };
    },
  );
  for (const duplicate of duplicates) {
    await context.tx.execute(sql`
      update notification_delivery
      set channel = ${`legacy_backfill_${duplicate.row.id}`}
      where id = ${duplicate.row.id}
    `);
  }
  await context.tx.execute(sql`
    update notification_delivery
    set
      notification_id = ${canonicalNotificationId},
      organization_id = ${context.organizationId},
      source_event_id = ${context.source.id},
      conversation_key = ${context.conversationKey},
      deduplicated_into_delivery_id = null,
      destination_kind = ${destination.destinationKind},
      destination_id = ${destination.destinationId}
    where id = ${canonical.id}
  `);
  for (const duplicate of duplicates) {
    await context.tx.execute(sql`
      update notification_delivery
      set
        notification_id = ${duplicate.finalNotificationId},
        organization_id = ${context.organizationId},
        source_event_id = null,
        conversation_key = ${context.conversationKey},
        deduplicated_into_delivery_id = ${canonical.id},
        channel = ${duplicate.row.channel},
        status = ${duplicate.update.status},
        last_error = ${duplicate.update.lastError},
        claim_token = null,
        claimed_at = null,
        lease_expires_at = null
      where id = ${duplicate.row.id}
    `);
  }
}

async function closeHistoricalSource(
  tx: Transaction,
  sourceId: string,
  notificationIds: readonly string[],
  now: Date,
): Promise<void> {
  const recipientRows = await tx.execute<{ incomplete: number }>(sql`
    select count(*)::int as incomplete
    from notification
    where id in (${sqlList(notificationIds)})
      and not (
        (source_event_id = ${sourceId} and deduplicated_into_notification_id is null)
        or
        (source_event_id is null and deduplicated_into_notification_id is not null and surface_in_inbox is false)
      )
  `);
  const deliveryRows = await tx.execute<{ incomplete: number }>(sql`
    select count(*)::int as incomplete
    from notification_delivery
    where (
      notification_id in (${sqlList(notificationIds)})
      or source_event_id = ${sourceId}
      or deduplicated_into_delivery_id in (
        select id from notification_delivery where source_event_id = ${sourceId}
      )
    )
      and not (
        (source_event_id = ${sourceId} and deduplicated_into_delivery_id is null)
        or
        (
          source_event_id is null
          and deduplicated_into_delivery_id is not null
          and status in ('delivered', 'succeeded', 'unavailable', 'skipped')
        )
      )
  `);
  if ((recipientRows[0]?.incomplete ?? 0) > 0 || (deliveryRows[0]?.incomplete ?? 0) > 0) {
    throw new Error(`Historical source ${sourceId} is not fully classified.`);
  }
  await tx.execute(sql`
    update notification_source_event
    set
      fanout_completed_at = coalesce(fanout_completed_at, ${postgresTimestamp(now)}),
      updated_at = ${postgresTimestamp(now)}
    where id = ${sourceId}
  `);
}

async function applySourceResolutionGroup(
  database: Database,
  organizationId: string,
  group: SourceResolutionGroup,
  now: Date,
): Promise<number> {
  return await database.transaction(async (tx) => {
    const source = await lockSourceEvent(tx, organizationId, group.resolution, now);
    const rows = await lockLegacyNotifications(
      tx,
      organizationId,
      group.resolution.equivalentNotificationIds,
    );
    const survivors = new Map<string, string>();
    for (const recipients of groupByUser(rows)) {
      const survivor = await classifyRecipientGroup(tx, source, recipients, now);
      survivors.set(survivor.userId, survivor.survivorId);
    }
    const deliveries = await lockLegacyDeliveries(
      tx,
      organizationId,
      group.resolution.equivalentNotificationIds,
      group.resolution.sourceDeliveryId,
    );
    await classifyDeliveryRows(
      tx,
      organizationId,
      source,
      group.resolution.subjectKey,
      survivors,
      deliveries,
      now,
    );
    await closeHistoricalSource(tx, source.id, group.resolution.equivalentNotificationIds, now);
    return rows.length;
  });
}

interface SourceSeedRow extends LegacyNotificationRow {}

async function notificationHighWaterMark(
  database: NotificationConversationBackfillDatabase,
  organizationId: string,
): Promise<string | null> {
  const rows = await database.execute<{ id: string | null }>(sql`
    select max(id) as id from notification where organization_id = ${organizationId}
  `);
  return rows[0]?.id ?? null;
}

async function deliveryHighWaterMark(
  database: NotificationConversationBackfillDatabase,
  organizationId: string,
): Promise<string | null> {
  const rows = await database.execute<{ id: string | null }>(sql`
    select max(id) as id
    from notification_delivery
    where organization_id = ${organizationId}
      or notification_id in (
        select id from notification where organization_id = ${organizationId}
      )
  `);
  return rows[0]?.id ?? null;
}

async function readSourceSeeds(
  database: NotificationConversationBackfillDatabase,
  organizationId: string,
  cursor: string | null,
  highWaterMark: string | null,
  batchSize: number,
): Promise<readonly SourceSeedRow[]> {
  if (highWaterMark === null) return [];
  return await database.execute<SourceSeedRow>(sql`
    select
      id,
      organization_id as "organizationId",
      user_id as "userId",
      type,
      reason,
      actor_name as "actorName",
      entity_type as "entityType",
      entity_id as "entityId",
      title,
      body,
      url,
      external_url as "externalUrl",
      source_event_id as "sourceEventId",
      conversation_id as "conversationId",
      occurred_at as "occurredAt",
      ingested_at as "ingestedAt",
      ingestion_seq::float8 as "ingestionSeq",
      surface_in_inbox as "surfaceInInbox",
      read_at as "readAt",
      snoozed_until as "snoozedUntil",
      dismissed_at as "dismissedAt",
      manual_unread_anchor as "manualUnreadAnchor",
      deduplicated_into_notification_id as "deduplicatedIntoNotificationId",
      delivered_channels as "deliveredChannels",
      created_at as "createdAt"
    from notification
    where organization_id = ${organizationId}
      and source_event_id is null
      and deduplicated_into_notification_id is null
      and id > ${cursor ?? ''}
      and id <= ${highWaterMark}
    order by id
    limit ${batchSize}
  `);
}

async function resolveSourceGroups(
  database: Database,
  seeds: readonly SourceSeedRow[],
  resolver: ResolveLegacyNotificationSource,
  batchSize: number,
  maxEquivalenceGroupRows: number,
): Promise<{
  readonly groups: readonly SourceResolutionGroup[];
  readonly cursor: string | null;
}> {
  const groups = new Map<string, SourceResolutionGroup>();
  let selectedRows = 0;
  let cursor: string | null = null;

  for (const seed of seeds) {
    const resolution = validateSourceResolution(
      seed.id,
      await resolver(database, notificationSourceInput(seed)),
      maxEquivalenceGroupRows,
    );
    const existing = groups.get(resolution.sourceEventKey);
    if (existing !== undefined) {
      if (!sameSourceResolution(existing.resolution, resolution)) {
        throw new Error(`Conflicting resolutions for ${resolution.sourceEventKey}.`);
      }
      groups.set(resolution.sourceEventKey, {
        resolution,
        seedIds: [...existing.seedIds, seed.id],
      });
      cursor = seed.id;
      continue;
    }
    if (
      selectedRows > 0 &&
      selectedRows + resolution.equivalentNotificationIds.length > batchSize
    ) {
      break;
    }
    groups.set(resolution.sourceEventKey, { resolution, seedIds: [seed.id] });
    selectedRows += resolution.equivalentNotificationIds.length;
    cursor = seed.id;
  }
  return { groups: [...groups.values()], cursor };
}

async function processSourceBatch(
  database: Database,
  input: ConversationBackfillBatchInput,
  highWaterMark: string | null,
  resolver: ResolveLegacyNotificationSource,
  maxEquivalenceGroupRows: number,
): Promise<ConversationBackfillBatchResult> {
  const actualHighWater =
    highWaterMark ?? (await notificationHighWaterMark(database, input.organizationId));
  const seeds = await readSourceSeeds(
    database,
    input.organizationId,
    input.cursor,
    actualHighWater,
    input.batchSize,
  );
  if (seeds.length === 0) {
    return {
      processedRows: 0,
      cursor: input.cursor,
      highWaterMark: actualHighWater,
      done: true,
    };
  }
  const planned = await resolveSourceGroups(
    database,
    seeds,
    resolver,
    input.batchSize,
    maxEquivalenceGroupRows,
  );
  if (planned.groups.length === 0 || planned.cursor === null) {
    throw new Error('Source batch planning made no progress.');
  }
  let processedRows = 0;
  for (const group of planned.groups) {
    processedRows += await applySourceResolutionGroup(
      database,
      input.organizationId,
      group,
      input.now,
    );
  }
  return {
    processedRows,
    cursor: planned.cursor,
    highWaterMark: actualHighWater,
    done: false,
  };
}

interface LinkedRecipientSeed extends Record<string, unknown> {
  readonly id: string;
  readonly sourceEventId: string;
}

async function processRecipientBatch(
  database: Database,
  input: ConversationBackfillBatchInput,
  highWaterMark: string | null,
): Promise<ConversationBackfillBatchResult> {
  const actualHighWater =
    highWaterMark ?? (await notificationHighWaterMark(database, input.organizationId));
  if (actualHighWater === null) {
    return { processedRows: 0, cursor: input.cursor, highWaterMark: null, done: true };
  }
  const seeds = await database.execute<LinkedRecipientSeed>(sql`
    select id, source_event_id as "sourceEventId"
    from notification
    where organization_id = ${input.organizationId}
      and source_event_id is not null
      and deduplicated_into_notification_id is null
      and (
        occurred_at is null
        or ingested_at is null
        or ingestion_seq is null
        or surface_in_inbox is null
      )
      and id > ${input.cursor ?? ''}
      and id <= ${actualHighWater}
    order by id
    limit ${input.batchSize}
  `);
  if (seeds.length === 0) {
    return {
      processedRows: 0,
      cursor: input.cursor,
      highWaterMark: actualHighWater,
      done: true,
    };
  }
  for (const seed of seeds) {
    await database.transaction(async (tx) => {
      const sources = await tx.execute<SourceEventRow>(sql`
        select
          id,
          source_event_key as "sourceEventKey",
          subject_type as "subjectType",
          subject_key as "subjectKey",
          occurred_at as "occurredAt",
          ingested_at as "ingestedAt",
          ingestion_seq::float8 as "ingestionSeq",
          fanout_completed_at as "fanoutCompletedAt"
        from notification_source_event
        where organization_id = ${input.organizationId}
          and id = ${seed.sourceEventId}
        for update
      `);
      const source = sources[0];
      if (source === undefined) throw new Error(`Source ${seed.sourceEventId} is missing.`);
      const rows = await lockLegacyNotifications(tx, input.organizationId, [seed.id]);
      const recipient = rows[0];
      if (recipient === undefined) throw new Error(`Recipient ${seed.id} is missing.`);
      await classifyRecipientGroup(tx, source, [recipient], input.now);
    });
  }
  return {
    processedRows: seeds.length,
    cursor: seeds.at(-1)?.id ?? input.cursor,
    highWaterMark: actualHighWater,
    done: false,
  };
}

interface DeliverySeed extends Record<string, unknown> {
  readonly id: string;
  readonly sourceEventId: string;
}

async function applyLinkedDeliverySource(
  database: Database,
  organizationId: string,
  sourceEventId: string,
  now: Date,
): Promise<number> {
  return await database.transaction(async (tx) => {
    const sources = await tx.execute<SourceEventRow>(sql`
      select
        id,
        source_event_key as "sourceEventKey",
        subject_type as "subjectType",
        subject_key as "subjectKey",
        occurred_at as "occurredAt",
        ingested_at as "ingestedAt",
        ingestion_seq::float8 as "ingestionSeq",
        fanout_completed_at as "fanoutCompletedAt"
      from notification_source_event
      where organization_id = ${organizationId} and id = ${sourceEventId}
      for update
    `);
    const source = sources[0];
    if (source === undefined) throw new Error(`Source ${sourceEventId} is missing.`);
    const recipients = await tx.execute<{ id: string; userId: string }>(sql`
      select id, user_id as "userId"
      from notification
      where organization_id = ${organizationId}
        and source_event_id = ${sourceEventId}
        and deduplicated_into_notification_id is null
      order by user_id, id
      for update
    `);
    const recipientIds = recipients.map((recipient) => recipient.id);
    if (recipientIds.length === 0) return 0;
    const survivors = new Map(
      recipients.map((recipient) => [recipient.userId, recipient.id] as const),
    );
    const deliveries = await lockLegacyDeliveries(tx, organizationId, recipientIds, undefined);
    await classifyDeliveryRows(
      tx,
      organizationId,
      source,
      source.subjectKey,
      survivors,
      deliveries,
      now,
    );
    await closeHistoricalSource(tx, source.id, recipientIds, now);
    return deliveries.length;
  });
}

async function processDeliveryBatch(
  database: Database,
  input: ConversationBackfillBatchInput,
  highWaterMark: string | null,
): Promise<ConversationBackfillBatchResult> {
  const actualHighWater =
    highWaterMark ?? (await deliveryHighWaterMark(database, input.organizationId));
  if (actualHighWater === null) {
    return { processedRows: 0, cursor: input.cursor, highWaterMark: null, done: true };
  }
  const seeds = await database.execute<DeliverySeed>(sql`
    select d.id, coalesce(d.source_event_id, n.source_event_id) as "sourceEventId"
    from notification_delivery d
    left join notification n on n.id = d.notification_id
    where coalesce(d.organization_id, n.organization_id) = ${input.organizationId}
      and d.deduplicated_into_delivery_id is null
      and coalesce(d.source_event_id, n.source_event_id) is not null
      and (d.source_event_id is null or d.conversation_key is null)
      and d.id > ${input.cursor ?? ''}
      and d.id <= ${actualHighWater}
    order by d.id
    limit ${input.batchSize}
  `);
  if (seeds.length === 0) {
    return {
      processedRows: 0,
      cursor: input.cursor,
      highWaterMark: actualHighWater,
      done: true,
    };
  }
  const sourceIds = [...new Set(seeds.map((seed) => seed.sourceEventId))].sort(compareText);
  let processedRows = 0;
  for (const sourceId of sourceIds) {
    processedRows += await applyLinkedDeliverySource(
      database,
      input.organizationId,
      sourceId,
      input.now,
    );
  }
  return {
    processedRows,
    cursor: seeds.at(-1)?.id ?? input.cursor,
    highWaterMark: actualHighWater,
    done: false,
  };
}

interface ConversationSeedRow extends LegacyNotificationRow {
  readonly sourceSubjectType: string;
  readonly sourceSubjectKey: string;
  readonly sourcePayload: Record<string, unknown> | null;
}

interface ConversationRow extends Record<string, unknown> {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly category: string;
  readonly accessHiddenAt: Date | null;
  readonly accessGeneration: number;
  readonly snoozeGeneration: number;
}

interface FoldedConversation {
  readonly latest: ConversationSeedRow;
  readonly eventCount: number;
  readonly unreadEventCount: number;
  readonly unreadMentionCount: number;
  readonly manualUnread: boolean;
  readonly lastMentionAt: Date | null;
  readonly readAt: Date | null;
  readonly snoozedUntil: Date | null;
  readonly dismissedAt: Date | null;
  readonly lastActivitySeq: number;
  readonly lastActivityAt: Date;
}

function conversationIdentityForRow(row: ConversationSeedRow): NotificationConversationIdentity {
  return resolveNotificationConversation({
    notificationId: row.id,
    type: row.type,
    entityType: row.entityType,
    entityId: row.entityId,
    url: row.url,
    source: {
      subjectType: row.sourceSubjectType,
      subjectKey: row.sourceSubjectKey,
      ...(row.sourcePayload === null ? {} : { payload: row.sourcePayload }),
    },
  });
}

function isMentionEvent(row: LegacyNotificationRow): boolean {
  return row.type === 'mention' || row.reason === 'mentioned';
}

function newestConversationEvent(rows: readonly ConversationSeedRow[]): ConversationSeedRow {
  const ordered = [...rows].sort((left, right) => {
    const leftSeq = left.ingestionSeq;
    const rightSeq = right.ingestionSeq;
    if (leftSeq === null || rightSeq === null) {
      throw new Error('A surfaced conversation event has no ingestion sequence.');
    }
    const bySequence = rightSeq - leftSeq;
    return bySequence === 0 ? compareText(right.id, left.id) : bySequence;
  });
  const newest = ordered[0];
  if (newest === undefined) throw new Error('A conversation cannot be built without events.');
  return newest;
}

function foldConversationRows(rows: readonly ConversationSeedRow[], now: Date): FoldedConversation {
  if (rows.length === 0) throw new Error('A conversation cannot be built without events.');
  const active = rows.filter((row) => row.dismissedAt === null);
  const visibleActive = active.filter(
    (row) => row.snoozedUntil === null || timestampMillis(row.snoozedUntil) <= timestampMillis(now),
  );
  let snapshotCandidates = rows;
  if (active.length > 0) snapshotCandidates = active;
  if (visibleActive.length > 0) snapshotCandidates = visibleActive;
  const latest = newestConversationEvent(snapshotCandidates);
  const lastActivity = newestConversationEvent(rows);
  const unreadRows = active.filter((row) => row.readAt === null && !row.manualUnreadAnchor);
  const unreadMentionCount = unreadRows.filter(isMentionEvent).length;
  const manualUnread =
    unreadRows.length === 0 && active.some((row) => row.readAt === null && row.manualUnreadAnchor);
  const futureSnoozes = active.flatMap((row) =>
    row.snoozedUntil !== null && timestampMillis(row.snoozedUntil) > timestampMillis(now)
      ? [row.snoozedUntil]
      : [],
  );
  const snoozedUntil =
    active.length > 0 && active.length === futureSnoozes.length
      ? earliestDate(futureSnoozes)
      : null;
  const dismissedAt =
    active.length === 0
      ? latestDate(rows.flatMap((row) => (row.dismissedAt === null ? [] : [row.dismissedAt])))
      : null;
  const readAt =
    unreadRows.length > 0 || manualUnread
      ? null
      : latestDate((active.length > 0 ? active : rows).flatMap((row) => row.readAt ?? []));
  const mentionDates = rows.filter(isMentionEvent).flatMap((row) => row.ingestedAt ?? []);
  if (
    latest.occurredAt === null ||
    latest.ingestedAt === null ||
    lastActivity.ingestedAt === null ||
    lastActivity.ingestionSeq === null
  ) {
    throw new Error('A surfaced conversation event has incomplete compatibility timestamps.');
  }
  return {
    latest,
    eventCount: rows.length,
    unreadEventCount: unreadRows.length,
    unreadMentionCount,
    manualUnread,
    lastMentionAt: latestDate(mentionDates),
    readAt,
    snoozedUntil,
    dismissedAt,
    lastActivitySeq: lastActivity.ingestionSeq,
    lastActivityAt: lastActivity.ingestedAt,
  };
}

async function readConversationSeeds(
  database: NotificationConversationBackfillDatabase,
  organizationId: string,
  cursor: string | null,
  highWaterMark: string | null,
  batchSize: number,
): Promise<readonly ConversationSeedRow[]> {
  if (highWaterMark === null) return [];
  return await database.execute<ConversationSeedRow>(sql`
    select
      n.id,
      n.organization_id as "organizationId",
      n.user_id as "userId",
      n.type,
      n.reason,
      n.actor_name as "actorName",
      n.entity_type as "entityType",
      n.entity_id as "entityId",
      n.title,
      n.body,
      n.url,
      n.external_url as "externalUrl",
      n.source_event_id as "sourceEventId",
      n.conversation_id as "conversationId",
      n.occurred_at as "occurredAt",
      n.ingested_at as "ingestedAt",
      n.ingestion_seq::float8 as "ingestionSeq",
      n.surface_in_inbox as "surfaceInInbox",
      n.read_at as "readAt",
      n.snoozed_until as "snoozedUntil",
      n.dismissed_at as "dismissedAt",
      n.manual_unread_anchor as "manualUnreadAnchor",
      n.deduplicated_into_notification_id as "deduplicatedIntoNotificationId",
      n.delivered_channels as "deliveredChannels",
      n.created_at as "createdAt",
      s.subject_type as "sourceSubjectType",
      s.subject_key as "sourceSubjectKey",
      s.payload as "sourcePayload"
    from notification n
    join notification_source_event s
      on s.organization_id = n.organization_id and s.id = n.source_event_id
    where n.organization_id = ${organizationId}
      and n.source_event_id is not null
      and n.deduplicated_into_notification_id is null
      and n.surface_in_inbox is true
      and n.conversation_id is null
      and n.id > ${cursor ?? ''}
      and n.id <= ${highWaterMark}
    order by n.id
    limit ${batchSize}
  `);
}

async function lockConversationEvents(
  tx: Transaction,
  organizationId: string,
  userId: string,
  subjectKey: string,
): Promise<readonly ConversationSeedRow[]> {
  return await tx.execute<ConversationSeedRow>(sql`
    select
      n.id,
      n.organization_id as "organizationId",
      n.user_id as "userId",
      n.type,
      n.reason,
      n.actor_name as "actorName",
      n.entity_type as "entityType",
      n.entity_id as "entityId",
      n.title,
      n.body,
      n.url,
      n.external_url as "externalUrl",
      n.source_event_id as "sourceEventId",
      n.conversation_id as "conversationId",
      n.occurred_at as "occurredAt",
      n.ingested_at as "ingestedAt",
      n.ingestion_seq::float8 as "ingestionSeq",
      n.surface_in_inbox as "surfaceInInbox",
      n.read_at as "readAt",
      n.snoozed_until as "snoozedUntil",
      n.dismissed_at as "dismissedAt",
      n.manual_unread_anchor as "manualUnreadAnchor",
      n.deduplicated_into_notification_id as "deduplicatedIntoNotificationId",
      n.delivered_channels as "deliveredChannels",
      n.created_at as "createdAt",
      s.subject_type as "sourceSubjectType",
      s.subject_key as "sourceSubjectKey",
      s.payload as "sourcePayload"
    from notification n
    join notification_source_event s
      on s.organization_id = n.organization_id and s.id = n.source_event_id
    where n.organization_id = ${organizationId}
      and n.user_id = ${userId}
      and s.subject_key = ${subjectKey}
      and n.deduplicated_into_notification_id is null
      and n.surface_in_inbox is true
    order by n.id
    for update of n
  `);
}

async function updateInboxStateCounters(
  tx: Transaction,
  organizationId: string,
  userId: string,
  now: Date,
): Promise<void> {
  const counters = await tx.execute<{
    unreadCount: number;
    unreadActivityCount: number;
    unreadMentionCount: number;
  }>(sql`
    select
      count(*) filter (
        where (unread_event_count > 0 or manual_unread is true)
          and dismissed_at is null
          and access_hidden_at is null
          and (snoozed_until is null or snoozed_until <= ${postgresTimestamp(now)})
      )::int as "unreadCount",
      count(*) filter (
        where category = 'activity'
          and (unread_event_count > 0 or manual_unread is true)
          and dismissed_at is null
          and access_hidden_at is null
          and (snoozed_until is null or snoozed_until <= ${postgresTimestamp(now)})
      )::int as "unreadActivityCount",
      count(*) filter (
        where unread_mention_count > 0
          and dismissed_at is null
          and access_hidden_at is null
          and (snoozed_until is null or snoozed_until <= ${postgresTimestamp(now)})
      )::int as "unreadMentionCount"
    from notification_conversation
    where organization_id = ${organizationId} and user_id = ${userId}
  `);
  const counter = counters[0] ?? {
    unreadCount: 0,
    unreadActivityCount: 0,
    unreadMentionCount: 0,
  };
  await tx.execute(sql`
    update notification_inbox_state
    set
      unread_count = ${counter.unreadCount},
      unread_activity_count = ${counter.unreadActivityCount},
      unread_mention_count = ${counter.unreadMentionCount},
      sync_id = nextval('sync_id_seq'),
      updated_at = ${postgresTimestamp(now)}
    where organization_id = ${organizationId} and user_id = ${userId}
  `);
}

async function applyConversationGroup(
  database: Database,
  organizationId: string,
  seed: ConversationSeedRow,
  identity: NotificationConversationIdentity,
  now: Date,
): Promise<number> {
  return await database.transaction(async (tx) => {
    await tx.execute(sql`
      insert into notification_inbox_state (organization_id, user_id, created_at, updated_at)
      values (
        ${organizationId},
        ${seed.userId},
        ${postgresTimestamp(now)},
        ${postgresTimestamp(now)}
      )
      on conflict (organization_id, user_id) do nothing
    `);
    await tx.execute(sql`
      select organization_id
      from notification_inbox_state
      where organization_id = ${organizationId} and user_id = ${seed.userId}
      for update
    `);

    const conversationId = randomUUIDv7();
    await tx.execute(sql`
      insert into notification_conversation (
        id,
        organization_id,
        user_id,
        conversation_key,
        subject_type,
        subject_id,
        category,
        created_at,
        updated_at
      ) values (
        ${conversationId},
        ${organizationId},
        ${seed.userId},
        ${identity.conversationKey},
        ${identity.subjectType},
        ${identity.subjectId},
        ${identity.category},
        ${postgresTimestamp(now)},
        ${postgresTimestamp(now)}
      )
      on conflict (organization_id, user_id, conversation_key) do nothing
    `);
    const conversations = await tx.execute<ConversationRow>(sql`
      select
        id,
        subject_type as "subjectType",
        subject_id as "subjectId",
        category,
        access_hidden_at as "accessHiddenAt",
        access_generation::float8 as "accessGeneration",
        snooze_generation::float8 as "snoozeGeneration"
      from notification_conversation
      where organization_id = ${organizationId}
        and user_id = ${seed.userId}
        and conversation_key = ${identity.conversationKey}
      for update
    `);
    const conversation = conversations[0];
    if (conversation === undefined) throw new Error('Failed to create notification conversation.');
    if (
      conversation.subjectType !== identity.subjectType ||
      conversation.subjectId !== identity.subjectId ||
      conversation.category !== identity.category
    ) {
      throw new Error(`Conversation identity conflict for ${identity.conversationKey}.`);
    }

    const events = await lockConversationEvents(
      tx,
      organizationId,
      seed.userId,
      seed.sourceSubjectKey,
    );
    for (const event of events) {
      const eventIdentity = conversationIdentityForRow(event);
      if (eventIdentity.conversationKey !== identity.conversationKey) {
        throw new Error(`Source ${seed.sourceSubjectKey} maps to multiple conversations.`);
      }
    }
    const folded = foldConversationRows(events, now);
    await tx.execute(sql`
      update notification
      set conversation_id = ${conversation.id}, sync_id = nextval('sync_id_seq')
      where organization_id = ${organizationId}
        and user_id = ${seed.userId}
        and id in (${sqlList(events.map((event) => event.id))})
    `);
    const snoozeGeneration =
      folded.snoozedUntil === null
        ? conversation.snoozeGeneration
        : Math.max(1, conversation.snoozeGeneration);
    await tx.execute(sql`
      update notification_conversation
      set
        latest_event_id = ${folded.latest.id},
        latest_type = ${folded.latest.type},
        latest_actor_name = ${folded.latest.actorName},
        latest_title = ${folded.latest.title},
        latest_body = ${folded.latest.body},
        latest_url = ${folded.latest.url},
        latest_external_url = ${folded.latest.externalUrl},
        latest_occurred_at = ${postgresTimestamp(folded.latest.occurredAt)},
        event_count = ${folded.eventCount},
        unread_event_count = ${folded.unreadEventCount},
        unread_mention_count = ${folded.unreadMentionCount},
        manual_unread = ${folded.manualUnread},
        last_mention_at = ${postgresTimestamp(folded.lastMentionAt)},
        read_at = ${postgresTimestamp(folded.readAt)},
        snoozed_until = ${postgresTimestamp(folded.snoozedUntil)},
        dismissed_at = ${postgresTimestamp(folded.dismissedAt)},
        snooze_generation = ${snoozeGeneration},
        last_activity_seq = ${folded.lastActivitySeq},
        last_activity_at = ${postgresTimestamp(folded.lastActivityAt)},
        sync_id = nextval('sync_id_seq'),
        updated_at = ${postgresTimestamp(now)}
      where id = ${conversation.id}
    `);
    if (folded.snoozedUntil !== null) {
      await tx.execute(sql`
        insert into notification_snooze_wake (
          id,
          organization_id,
          user_id,
          conversation_id,
          snooze_generation,
          wake_at,
          status,
          created_at,
          updated_at
        ) values (
          ${randomUUIDv7()},
          ${organizationId},
          ${seed.userId},
          ${conversation.id},
          ${snoozeGeneration},
          ${postgresTimestamp(folded.snoozedUntil)},
          'pending',
          ${postgresTimestamp(now)},
          ${postgresTimestamp(now)}
        )
        on conflict (organization_id, conversation_id, snooze_generation) do nothing
      `);
    }
    await updateInboxStateCounters(tx, organizationId, seed.userId, now);
    return events.length;
  });
}

async function processConversationBatch(
  database: Database,
  input: ConversationBackfillBatchInput,
  highWaterMark: string | null,
): Promise<ConversationBackfillBatchResult> {
  const actualHighWater =
    highWaterMark ?? (await notificationHighWaterMark(database, input.organizationId));
  const seeds = await readConversationSeeds(
    database,
    input.organizationId,
    input.cursor,
    actualHighWater,
    input.batchSize,
  );
  if (seeds.length === 0) {
    return {
      processedRows: 0,
      cursor: input.cursor,
      highWaterMark: actualHighWater,
      done: true,
    };
  }
  const identities = new Map<
    string,
    { seed: ConversationSeedRow; identity: NotificationConversationIdentity }
  >();
  for (const seed of seeds) {
    const identity = conversationIdentityForRow(seed);
    const key = JSON.stringify([seed.userId, identity.conversationKey]);
    identities.set(key, identities.get(key) ?? { seed, identity });
  }
  let processedRows = 0;
  for (const { seed, identity } of identities.values()) {
    processedRows += await applyConversationGroup(
      database,
      input.organizationId,
      seed,
      identity,
      input.now,
    );
  }
  return {
    processedRows,
    cursor: seeds.at(-1)?.id ?? input.cursor,
    highWaterMark: actualHighWater,
    done: false,
  };
}

async function processTailBatch(
  database: Database,
  input: ConversationBackfillBatchInput,
  resolver: ResolveLegacyNotificationSource,
  maxEquivalenceGroupRows: number,
  passNumber: number,
): Promise<ConversationBackfillBatchResult> {
  const tailInput = { ...input, cursor: null };
  const sources = await processSourceBatch(
    database,
    tailInput,
    null,
    resolver,
    maxEquivalenceGroupRows,
  );
  if (!sources.done) {
    return {
      processedRows: sources.processedRows,
      cursor: null,
      passNumber,
      done: false,
    };
  }
  const recipients = await processRecipientBatch(database, tailInput, null);
  if (!recipients.done) {
    return {
      processedRows: recipients.processedRows,
      cursor: null,
      passNumber,
      done: false,
    };
  }
  const deliveries = await processDeliveryBatch(database, tailInput, null);
  if (!deliveries.done) {
    return {
      processedRows: deliveries.processedRows,
      cursor: null,
      passNumber,
      done: false,
    };
  }
  const conversations = await processConversationBatch(database, tailInput, null);
  if (!conversations.done) {
    return {
      processedRows: conversations.processedRows,
      cursor: null,
      passNumber,
      done: false,
    };
  }
  return {
    processedRows: 0,
    cursor: null,
    passNumber: passNumber + 1,
    done: true,
  };
}

class DatabaseConversationBackfillStore implements ConversationBackfillStore {
  constructor(
    private readonly database: Database,
    private readonly resolver: ResolveLegacyNotificationSource,
    private readonly maxEquivalenceGroupRows: number,
  ) {}

  async listOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.database.execute<{ id: string }>(sql`
      select id from organization order by id
    `);
    return rows.map((row) => row.id);
  }

  async readProgress(
    organizationId: string,
    phase: ConversationBackfillPhase,
  ): Promise<ConversationBackfillProgress | null> {
    const rows = await this.database.execute<BackfillProgressRow>(sql`
      select
        organization_id as "organizationId",
        phase,
        cursor,
        high_water_mark as "highWaterMark",
        status,
        processed_rows::float8 as "processedRows",
        pass_number as "passNumber",
        started_at as "startedAt",
        updated_at as "updatedAt",
        completed_at as "completedAt",
        last_error as "lastError"
      from notification_conversation_backfill_progress
      where organization_id = ${organizationId} and phase = ${phase}
    `);
    const row = rows[0];
    return row === undefined ? null : progressFromRow(row);
  }

  async writeProgress(progress: ConversationBackfillProgress): Promise<void> {
    await this.database.execute(sql`
      insert into notification_conversation_backfill_progress (
        id,
        organization_id,
        phase,
        cursor,
        high_water_mark,
        status,
        processed_rows,
        pass_number,
        started_at,
        updated_at,
        completed_at,
        last_error
      ) values (
        ${randomUUIDv7()},
        ${progress.organizationId},
        ${progress.phase},
        ${progress.cursor},
        ${progress.highWaterMark},
        ${progress.status},
        ${progress.processedRows},
        ${progress.passNumber},
        ${postgresTimestamp(progress.startedAt)},
        ${postgresTimestamp(progress.updatedAt)},
        ${postgresTimestamp(progress.completedAt)},
        ${progress.lastError}
      )
      on conflict (organization_id, phase) do update set
        cursor = excluded.cursor,
        high_water_mark = excluded.high_water_mark,
        status = excluded.status,
        processed_rows = excluded.processed_rows,
        pass_number = excluded.pass_number,
        started_at = coalesce(notification_conversation_backfill_progress.started_at, excluded.started_at),
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        last_error = excluded.last_error
    `);
  }

  async processBatch(
    input: ConversationBackfillBatchInput,
  ): Promise<ConversationBackfillBatchResult> {
    const progress = await this.readProgress(input.organizationId, input.phase);
    const highWaterMark = progress?.highWaterMark ?? null;
    if (input.phase === 'sources') {
      return await processSourceBatch(
        this.database,
        input,
        highWaterMark,
        this.resolver,
        this.maxEquivalenceGroupRows,
      );
    }
    if (input.phase === 'recipients') {
      return await processRecipientBatch(this.database, input, highWaterMark);
    }
    if (input.phase === 'deliveries') {
      return await processDeliveryBatch(this.database, input, highWaterMark);
    }
    if (input.phase === 'conversations') {
      return await processConversationBatch(this.database, input, highWaterMark);
    }
    return await processTailBatch(
      this.database,
      input,
      this.resolver,
      this.maxEquivalenceGroupRows,
      progress?.passNumber ?? 1,
    );
  }
}

export async function runNotificationConversationBackfill(
  database: Database,
  options: NotificationConversationBackfillOptions = {},
): Promise<ConversationBackfillRunResult> {
  const maxEquivalenceGroupRows = options.maxEquivalenceGroupRows ?? 10_000;
  if (!Number.isInteger(maxEquivalenceGroupRows) || maxEquivalenceGroupRows < 1) {
    throw new Error('Maximum source equivalence group size must be positive.');
  }
  const store = new DatabaseConversationBackfillStore(
    database,
    options.resolveLegacySource ?? defaultLegacySourceResolution,
    maxEquivalenceGroupRows,
  );
  return await runResumableConversationBackfill(store, options);
}

export interface NotificationConversationBackfillDrift {
  readonly unlinkedSurfacedRows: number;
  readonly unclassifiedRecipientRows: number;
  readonly incompleteHistoricalSources: number;
  readonly sourceLessNonAuditDeliveries: number;
  readonly retryableAuditDeliveries: number;
  readonly ambiguousAuditDeliveries: number;
  readonly canonicalDestinationCollisions: number;
  readonly recipientAuditDrift: number;
  readonly deliveryAuditDrift: number;
  readonly conversationStateDrift: number;
  readonly inboxStateDrift: number;
}

export interface NotificationConversationBackfillVerification {
  readonly ok: boolean;
  readonly organizations: readonly {
    readonly organizationId: string;
    readonly drift: NotificationConversationBackfillDrift;
  }[];
  readonly totals: NotificationConversationBackfillDrift;
}

export interface NotificationConversationBackfillVerifyOptions {
  readonly organizationIds?: readonly string[];
  readonly now?: Date;
}

const emptyBackfillDrift = (): NotificationConversationBackfillDrift => ({
  unlinkedSurfacedRows: 0,
  unclassifiedRecipientRows: 0,
  incompleteHistoricalSources: 0,
  sourceLessNonAuditDeliveries: 0,
  retryableAuditDeliveries: 0,
  ambiguousAuditDeliveries: 0,
  canonicalDestinationCollisions: 0,
  recipientAuditDrift: 0,
  deliveryAuditDrift: 0,
  conversationStateDrift: 0,
  inboxStateDrift: 0,
});

function addBackfillDrift(
  left: NotificationConversationBackfillDrift,
  right: NotificationConversationBackfillDrift,
): NotificationConversationBackfillDrift {
  return {
    unlinkedSurfacedRows: left.unlinkedSurfacedRows + right.unlinkedSurfacedRows,
    unclassifiedRecipientRows: left.unclassifiedRecipientRows + right.unclassifiedRecipientRows,
    incompleteHistoricalSources:
      left.incompleteHistoricalSources + right.incompleteHistoricalSources,
    sourceLessNonAuditDeliveries:
      left.sourceLessNonAuditDeliveries + right.sourceLessNonAuditDeliveries,
    retryableAuditDeliveries: left.retryableAuditDeliveries + right.retryableAuditDeliveries,
    ambiguousAuditDeliveries: left.ambiguousAuditDeliveries + right.ambiguousAuditDeliveries,
    canonicalDestinationCollisions:
      left.canonicalDestinationCollisions + right.canonicalDestinationCollisions,
    recipientAuditDrift: left.recipientAuditDrift + right.recipientAuditDrift,
    deliveryAuditDrift: left.deliveryAuditDrift + right.deliveryAuditDrift,
    conversationStateDrift: left.conversationStateDrift + right.conversationStateDrift,
    inboxStateDrift: left.inboxStateDrift + right.inboxStateDrift,
  };
}

function driftIsZero(drift: NotificationConversationBackfillDrift): boolean {
  return Object.values(drift).every((value) => value === 0);
}

async function countDrift(
  database: NotificationConversationBackfillDatabase,
  query: ReturnType<typeof sql>,
): Promise<number> {
  const rows = await database.execute<{ count: number }>(query);
  return rows[0]?.count ?? 0;
}

async function verifyOrganizationBackfill(
  database: NotificationConversationBackfillDatabase,
  organizationId: string,
  now: Date,
): Promise<NotificationConversationBackfillDrift> {
  const [
    unlinkedSurfacedRows,
    unclassifiedRecipientRows,
    incompleteHistoricalSources,
    sourceLessNonAuditDeliveries,
    retryableAuditDeliveries,
    ambiguousAuditDeliveries,
    canonicalDestinationCollisions,
    recipientAuditDrift,
    deliveryAuditDrift,
    conversationStateDrift,
    inboxStateDrift,
  ] = await Promise.all([
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification
        where organization_id = ${organizationId}
          and surface_in_inbox is true
          and conversation_id is null
          and deduplicated_into_notification_id is null
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification
        where organization_id = ${organizationId}
          and (
            (source_event_id is null and deduplicated_into_notification_id is null)
            or
            (source_event_id is not null and deduplicated_into_notification_id is not null)
          )
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification_source_event s
        where s.organization_id = ${organizationId}
          and s.fanout_completed_at is null
          and exists (
            select 1
            from notification n
            where n.organization_id = s.organization_id
              and (
                n.source_event_id = s.id
                or n.deduplicated_into_notification_id in (
                  select survivor.id
                  from notification survivor
                  where survivor.organization_id = s.organization_id
                    and survivor.source_event_id = s.id
                )
              )
          )
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification_delivery d
        left join notification n on n.id = d.notification_id
        where coalesce(d.organization_id, n.organization_id) = ${organizationId}
          and d.source_event_id is null
          and d.deduplicated_into_delivery_id is null
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification_delivery
        where organization_id = ${organizationId}
          and deduplicated_into_delivery_id is not null
          and status in ('pending', 'failed')
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification_delivery
        where organization_id = ${organizationId}
          and deduplicated_into_delivery_id is not null
          and (
            status in ('processing', 'ambiguous')
            or claim_token is not null
            or claimed_at is not null
            or lease_expires_at is not null
            or (send_started_at is not null and delivered_at is null)
          )
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from (
          select 1
          from notification_delivery
          where organization_id = ${organizationId}
            and source_event_id is not null
            and deduplicated_into_delivery_id is null
          group by
            source_event_id,
            channel,
            integration_id,
            destination_kind,
            destination_id
          having count(*) > 1
        ) collisions
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification duplicate
        left join notification survivor
          on survivor.organization_id = duplicate.organization_id
          and survivor.user_id = duplicate.user_id
          and survivor.id = duplicate.deduplicated_into_notification_id
        where duplicate.organization_id = ${organizationId}
          and duplicate.deduplicated_into_notification_id is not null
          and (
            duplicate.source_event_id is not null
            or duplicate.surface_in_inbox is distinct from false
            or survivor.id is null
            or survivor.source_event_id is null
            or survivor.deduplicated_into_notification_id is not null
          )
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification_delivery duplicate
        left join notification_delivery survivor
          on survivor.organization_id = duplicate.organization_id
          and survivor.id = duplicate.deduplicated_into_delivery_id
        where duplicate.organization_id = ${organizationId}
          and duplicate.deduplicated_into_delivery_id is not null
          and (
            duplicate.source_event_id is not null
            or duplicate.status not in ('delivered', 'succeeded', 'unavailable', 'skipped')
            or survivor.id is null
            or survivor.source_event_id is null
            or survivor.deduplicated_into_delivery_id is not null
          )
      `,
    ),
    countDrift(
      database,
      sql`
        select count(*)::int as count
        from notification_conversation c
        left join lateral (
          select
            count(*)::int as event_count,
            count(*) filter (
              where n.dismissed_at is null
                and n.read_at is null
                and n.manual_unread_anchor is false
            )::int as unread_event_count,
            count(*) filter (
              where n.dismissed_at is null
                and n.read_at is null
                and n.manual_unread_anchor is false
                and (n.type = 'mention' or n.reason = 'mentioned')
            )::int as unread_mention_count,
            count(*) filter (
              where n.dismissed_at is null
                and n.read_at is null
                and n.manual_unread_anchor is true
            )::int as manual_anchor_count,
            count(*) filter (where n.dismissed_at is null)::int as active_count,
            count(*) filter (
              where n.dismissed_at is null and n.snoozed_until > ${postgresTimestamp(now)}
            )::int as future_snooze_count,
            min(n.snoozed_until) filter (
              where n.dismissed_at is null and n.snoozed_until > ${postgresTimestamp(now)}
            ) as expected_snoozed_until,
            max(n.dismissed_at) as expected_dismissed_at
          from notification n
          where n.organization_id = c.organization_id
            and n.user_id = c.user_id
            and n.conversation_id = c.id
            and n.surface_in_inbox is true
            and n.deduplicated_into_notification_id is null
        ) folded on true
        left join lateral (
          select n.id
          from notification n
          where n.organization_id = c.organization_id
            and n.user_id = c.user_id
            and n.conversation_id = c.id
            and n.surface_in_inbox is true
            and n.deduplicated_into_notification_id is null
          order by
            (
              n.dismissed_at is null
              and (
                n.snoozed_until is null
                or n.snoozed_until <= ${postgresTimestamp(now)}
              )
            ) desc,
            (n.dismissed_at is null) desc,
            n.ingestion_seq desc,
            n.id desc
          limit 1
        ) latest on true
        where c.organization_id = ${organizationId}
          and (
            c.event_count is distinct from coalesce(folded.event_count, 0)
            or c.unread_event_count is distinct from coalesce(folded.unread_event_count, 0)
            or c.unread_mention_count is distinct from coalesce(folded.unread_mention_count, 0)
            or c.manual_unread is distinct from (
              coalesce(folded.unread_event_count, 0) = 0
              and coalesce(folded.manual_anchor_count, 0) > 0
            )
            or c.dismissed_at is distinct from (
              case
                when coalesce(folded.active_count, 0) = 0
                then folded.expected_dismissed_at
                else null
              end
            )
            or c.snoozed_until is distinct from (
              case
                when folded.active_count > 0
                  and folded.active_count = folded.future_snooze_count
                then folded.expected_snoozed_until
                else null
              end
            )
            or c.latest_event_id is distinct from latest.id
          )
      `,
    ),
    countDrift(
      database,
      sql`
        with expected as (
          select
            organization_id,
            user_id,
            count(*) filter (
              where (unread_event_count > 0 or manual_unread is true)
                and dismissed_at is null
                and access_hidden_at is null
                and (
                  snoozed_until is null
                  or snoozed_until <= ${postgresTimestamp(now)}
                )
            )::int as unread_count,
            count(*) filter (
              where category = 'activity'
                and (unread_event_count > 0 or manual_unread is true)
                and dismissed_at is null
                and access_hidden_at is null
                and (
                  snoozed_until is null
                  or snoozed_until <= ${postgresTimestamp(now)}
                )
            )::int as unread_activity_count,
            count(*) filter (
              where unread_mention_count > 0
                and dismissed_at is null
                and access_hidden_at is null
                and (
                  snoozed_until is null
                  or snoozed_until <= ${postgresTimestamp(now)}
                )
            )::int as unread_mention_count
          from notification_conversation
          where organization_id = ${organizationId}
          group by organization_id, user_id
        )
        select count(*)::int as count
        from expected
        full join notification_inbox_state state
          on state.organization_id = expected.organization_id
          and state.user_id = expected.user_id
        where coalesce(expected.organization_id, state.organization_id) = ${organizationId}
          and (
            state.organization_id is null
            or expected.organization_id is null
            or state.unread_count is distinct from expected.unread_count
            or state.unread_activity_count is distinct from expected.unread_activity_count
            or state.unread_mention_count is distinct from expected.unread_mention_count
          )
      `,
    ),
  ]);
  return {
    unlinkedSurfacedRows,
    unclassifiedRecipientRows,
    incompleteHistoricalSources,
    sourceLessNonAuditDeliveries,
    retryableAuditDeliveries,
    ambiguousAuditDeliveries,
    canonicalDestinationCollisions,
    recipientAuditDrift,
    deliveryAuditDrift,
    conversationStateDrift,
    inboxStateDrift,
  };
}

export async function verifyNotificationConversationBackfill(
  database: Database,
  options: NotificationConversationBackfillVerifyOptions = {},
): Promise<NotificationConversationBackfillVerification> {
  const now = options.now ?? new Date();
  const organizationIds =
    options.organizationIds === undefined
      ? (await database.execute<{ id: string }>(sql`select id from organization order by id`)).map(
          (row) => row.id,
        )
      : [...new Set(options.organizationIds)].sort(compareText);
  const organizations = [] as {
    readonly organizationId: string;
    readonly drift: NotificationConversationBackfillDrift;
  }[];
  let totals = emptyBackfillDrift();
  for (const organizationId of organizationIds) {
    const drift = await verifyOrganizationBackfill(database, organizationId, now);
    organizations.push({ organizationId, drift });
    totals = addBackfillDrift(totals, drift);
  }
  return { ok: driftIsZero(totals), organizations, totals };
}
