import { createHash } from 'node:crypto';
import { and, db, eq, isNull, lte, schema } from '@orbit/db';
import { validationFailed } from '@orbit/shared/errors';
import { newId } from '../internal.ts';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const val = (value as Record<string, unknown>)[key];
    if (val !== undefined) {
      result[key] = canonicalize(val);
    }
  }
  return result;
}

export function hashParams(params: unknown): string {
  const canonical = canonicalize(params);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export type IdempotencySlot =
  | { readonly status: 'claimed'; readonly slotId: string }
  | { readonly status: 'processing' }
  | { readonly status: 'done'; readonly response: Record<string, unknown> };

type IdempotencyRow = typeof schema.mcpIdempotencyKey.$inferSelect;

async function tryReclaimExpiredSlot(
  current: IdempotencyRow,
  tool: string,
  paramsHash: string,
  now: Date,
  expiresAt: Date,
): Promise<{ readonly reclaimedSlotId?: string; readonly current: IdempotencyRow }> {
  if (current.expiresAt > now) {
    return { current };
  }

  const reclaimed = await db
    .update(schema.mcpIdempotencyKey)
    .set({ tool, paramsHash, response: null, createdAt: now, expiresAt })
    .where(
      and(
        eq(schema.mcpIdempotencyKey.id, current.id),
        eq(schema.mcpIdempotencyKey.createdAt, current.createdAt),
        lte(schema.mcpIdempotencyKey.expiresAt, now),
      ),
    )
    .returning({ id: schema.mcpIdempotencyKey.id });

  if (reclaimed.length > 0 && reclaimed[0] !== undefined) {
    return { reclaimedSlotId: reclaimed[0].id, current };
  }

  const [reloaded] = await db
    .select()
    .from(schema.mcpIdempotencyKey)
    .where(eq(schema.mcpIdempotencyKey.id, current.id))
    .limit(1);

  return { current: reloaded ?? current };
}

async function tryReclaimStalledSlot(
  current: IdempotencyRow,
  tool: string,
  paramsHash: string,
  now: Date,
  expiresAt: Date,
): Promise<{ readonly reclaimedSlotId?: string; readonly current: IdempotencyRow }> {
  if (current.response !== null || now.getTime() - current.createdAt.getTime() <= 60_000) {
    return { current };
  }

  const reclaimed = await db
    .update(schema.mcpIdempotencyKey)
    .set({ tool, paramsHash, response: null, createdAt: now, expiresAt })
    .where(
      and(
        eq(schema.mcpIdempotencyKey.id, current.id),
        eq(schema.mcpIdempotencyKey.createdAt, current.createdAt),
        isNull(schema.mcpIdempotencyKey.response),
      ),
    )
    .returning({ id: schema.mcpIdempotencyKey.id });

  if (reclaimed.length > 0 && reclaimed[0] !== undefined) {
    return { reclaimedSlotId: reclaimed[0].id, current };
  }

  const [reloaded] = await db
    .select()
    .from(schema.mcpIdempotencyKey)
    .where(eq(schema.mcpIdempotencyKey.id, current.id))
    .limit(1);

  return { current: reloaded ?? current };
}

export async function claimIdempotencySlot(
  grantId: string,
  key: string,
  tool: string,
  paramsHash: string,
  now: Date = new Date(),
): Promise<IdempotencySlot> {
  const expiresAt = new Date(now.getTime() + 23 * 60 * 60_000);

  const inserted = await db
    .insert(schema.mcpIdempotencyKey)
    .values({
      id: newId(),
      grantId,
      key,
      tool,
      paramsHash,
      response: null,
      createdAt: now,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.mcpIdempotencyKey.id });

  if (inserted.length > 0 && inserted[0] !== undefined) {
    return { status: 'claimed', slotId: inserted[0].id };
  }

  const [existing] = await db
    .select()
    .from(schema.mcpIdempotencyKey)
    .where(
      and(eq(schema.mcpIdempotencyKey.grantId, grantId), eq(schema.mcpIdempotencyKey.key, key)),
    )
    .limit(1);

  if (existing === undefined) {
    return { status: 'claimed', slotId: newId() };
  }

  let current = existing;
  const expiredOutcome = await tryReclaimExpiredSlot(current, tool, paramsHash, now, expiresAt);
  if (expiredOutcome.reclaimedSlotId !== undefined) {
    return { status: 'claimed', slotId: expiredOutcome.reclaimedSlotId };
  }
  current = expiredOutcome.current;

  if (current.tool !== tool || current.paramsHash !== paramsHash) {
    throw validationFailed('Idempotency key was previously used with different arguments.');
  }

  const stalledOutcome = await tryReclaimStalledSlot(current, tool, paramsHash, now, expiresAt);
  if (stalledOutcome.reclaimedSlotId !== undefined) {
    return { status: 'claimed', slotId: stalledOutcome.reclaimedSlotId };
  }
  current = stalledOutcome.current;

  if (current.response === null) {
    return { status: 'processing' };
  }

  return {
    status: 'done',
    response: JSON.parse(current.response) as Record<string, unknown>,
  };
}

export async function resolveIdempotencySlot(
  slotId: string,
  response: Record<string, unknown>,
): Promise<void> {
  await db
    .update(schema.mcpIdempotencyKey)
    .set({ response: JSON.stringify(response) })
    .where(eq(schema.mcpIdempotencyKey.id, slotId));
}
