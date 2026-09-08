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

export async function getIdempotentResponse(
  grantId: string,
  key: string,
  tool: string,
  paramsHash: string,
  now: Date = new Date(),
): Promise<Record<string, unknown> | null> {
  const [row] = await db
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

  if (row === undefined) return null;

  if (row.tool !== tool || row.paramsHash !== paramsHash) {
    throw validationFailed('Idempotency key was previously used with different arguments.');
  }

  return JSON.parse(row.response) as Record<string, unknown>;
}

export async function recordIdempotentResponse(
  grantId: string,
  key: string,
  tool: string,
  paramsHash: string,
  response: Record<string, unknown>,
  now: Date = new Date(),
): Promise<void> {
  const expiresAt = new Date(now.getTime() + 86_400_000);
  await db
    .insert(schema.mcpIdempotencyKey)
    .values({
      id: newId(),
      grantId,
      key,
      tool,
      paramsHash,
      response: JSON.stringify(response),
      createdAt: now,
      expiresAt,
    })
    .onConflictDoNothing();
}
