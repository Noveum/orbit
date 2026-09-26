import { and, db, eq, inArray, isNull, schema, sql, type Transaction } from '@orbit/db';
import { type SyncAction, syncActionSchema } from '@orbit/shared/events';
import { newId } from '../internal.ts';

export function redactPublicPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPublicPayload);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      key === 'grantId' || key === 'grant_id' ? [] : [[key, redactPublicPayload(nested)]],
    ),
  );
}

export async function stageIssueActions(
  tx: Transaction,
  aggregateId: string,
  actions: readonly SyncAction[],
  options: { readonly attribution?: SyncAction['attribution']; readonly grantId?: string } = {},
): Promise<SyncAction[]> {
  if (actions.length === 0) return [];
  const rows = actions.map((action) => {
    const id = newId();
    return {
      id,
      organizationId: action.organizationId,
      aggregateId,
      syncId: action.syncId,
      payload: {
        ...action,
        eventId: id,
        ...(options.attribution === undefined ? {} : { attribution: options.attribution }),
        ...(options.grantId === undefined ? {} : { grantId: options.grantId }),
      },
    };
  });
  await tx.insert(schema.issueOutbox).values(rows);
  return rows.map((row) => syncActionSchema.parse(row.payload));
}

export interface IssueOutboxDrainOptions {
  readonly publish: (actions: SyncAction[]) => Promise<void>;
  readonly eventIds?: readonly string[];
  readonly now?: Date;
  readonly batchSize?: number;
  readonly leaseMs?: number;
}

export interface IssueOutboxStats {
  readonly backlog: number;
  readonly retrying: number;
  readonly overThreshold: number;
  readonly oldestAvailableAt: string | null;
  readonly maxAttempts: number;
}

export async function issueOutboxStats(): Promise<IssueOutboxStats> {
  const rows = await db.execute<{
    backlog: number;
    retrying: number;
    over_threshold: number;
    oldest_available_at: Date | string | null;
    max_attempts: number;
  }>(sql`
    select count(*)::int as backlog,
      count(*) filter (where attempts > 0)::int as retrying,
      count(*) filter (where attempts >= 10)::int as over_threshold,
      min(available_at) as oldest_available_at,
      coalesce(max(attempts), 0)::int as max_attempts
    from issue_outbox where delivered_at is null
  `);
  const row = rows[0];
  const oldestAvailableAt = row?.oldest_available_at;
  return {
    backlog: row?.backlog ?? 0,
    retrying: row?.retrying ?? 0,
    overThreshold: row?.over_threshold ?? 0,
    oldestAvailableAt:
      oldestAvailableAt == null
        ? null
        : (oldestAvailableAt instanceof Date
            ? oldestAvailableAt
            : new Date(oldestAvailableAt)
          ).toISOString(),
    maxAttempts: row?.max_attempts ?? 0,
  };
}

export async function drainIssueOutbox(options: IssueOutboxDrainOptions): Promise<number> {
  if (options.eventIds?.length === 0) return 0;
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? 30_000;
  const batchSize = Math.min(Math.max(options.batchSize ?? 50, 1), 200);
  const leaseOwner = newId();
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const nowIso = now.toISOString();
  const leaseUntilIso = leaseUntil.toISOString();
  const eventFilter =
    options.eventIds === undefined
      ? sql`true`
      : inArray(schema.issueOutbox.id, [...options.eventIds]);
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update issue_outbox set lease_until = ${leaseUntilIso}::timestamptz, lease_owner = ${leaseOwner}
      where id in (
        select id from issue_outbox
        where delivered_at is null and available_at <= ${nowIso}::timestamptz
          and ${eventFilter}
          and (lease_until is null or lease_until <= ${nowIso}::timestamptz)
        order by available_at, id
        for update skip locked
        limit ${batchSize}
      )
      returning id
    `);
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    return await tx.select().from(schema.issueOutbox).where(inArray(schema.issueOutbox.id, ids));
  });
  for (const row of claimed) {
    try {
      const action = syncActionSchema.parse(redactPublicPayload(row.payload));
      await options.publish([action]);
      await db
        .update(schema.issueOutbox)
        .set({ deliveredAt: new Date(), leaseUntil: null, leaseOwner: null, lastError: null })
        .where(
          and(
            eq(schema.issueOutbox.id, row.id),
            eq(schema.issueOutbox.leaseOwner, leaseOwner),
            isNull(schema.issueOutbox.deliveredAt),
          ),
        );
    } catch (error: unknown) {
      const attempts = row.attempts + 1;
      if (attempts >= 10)
        console.error('[orbit] issue outbox event exceeded retry threshold', {
          eventId: row.id,
          attempts,
        });
      const retryMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
      await db
        .update(schema.issueOutbox)
        .set({
          attempts,
          lastError:
            error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          availableAt: new Date(now.getTime() + retryMs),
          leaseUntil: null,
          leaseOwner: null,
        })
        .where(
          and(
            eq(schema.issueOutbox.id, row.id),
            eq(schema.issueOutbox.leaseOwner, leaseOwner),
            isNull(schema.issueOutbox.deliveredAt),
          ),
        );
    }
  }
  return claimed.length;
}
