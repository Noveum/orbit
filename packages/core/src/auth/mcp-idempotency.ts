import { createHash } from 'node:crypto';
import { and, db, eq, gt, schema } from '@orbit/db';
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
      and(
        eq(schema.mcpIdempotencyKey.grantId, grantId),
        eq(schema.mcpIdempotencyKey.key, key),
        gt(schema.mcpIdempotencyKey.expiresAt, now),
      ),
    )
    .limit(1);

  if (existing === undefined) {
    return { status: 'claimed', slotId: newId() };
  }

  if (existing.tool !== tool || existing.paramsHash !== paramsHash) {
    throw validationFailed('Idempotency key was previously used with different arguments.');
  }

  if (existing.response === null) {
    return { status: 'processing' };
  }

  return {
    status: 'done',
    response: JSON.parse(existing.response) as Record<string, unknown>,
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
