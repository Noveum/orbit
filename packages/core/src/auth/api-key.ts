import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import { internal, unauthorized } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

export type ApiKeyRow = typeof schema.apiKey.$inferSelect;

export const API_KEY_PREFIX = 'orb_';
export const API_KEY_PREFIX_LENGTH = 12;
const API_KEY_SECRET_BYTES = 24;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_SECRET_BYTES).toString('base64url')}`;
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH);
}

function hashesMatch(stored: string, candidate: string): boolean {
  const left = Buffer.from(stored, 'utf8');
  const right = Buffer.from(candidate, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface CreateApiKeyInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly name: string;
  readonly expiresAt?: Date | null;
}

export interface CreatedApiKey {
  readonly key: string;
  readonly apiKey: ApiKeyRow;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  const key = generateApiKey();
  const [row] = await db
    .insert(schema.apiKey)
    .values({
      id: newId(),
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name,
      hashedKey: hashApiKey(key),
      prefix: apiKeyPrefix(key),
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (row === undefined) throw internal('The API key could not be created.');
  return { key, apiKey: row };
}

export interface ApiKeyIdentity {
  readonly principal: Principal;
  readonly apiKey: ApiKeyRow;
}

export async function verifyApiKey(key: string, now: Date = new Date()): Promise<ApiKeyIdentity> {
  const rejection = unauthorized('That API key is not valid.');
  if (!key.startsWith(API_KEY_PREFIX) || key.length <= API_KEY_PREFIX_LENGTH) throw rejection;

  const candidate = hashApiKey(key);
  const rows = await db
    .select()
    .from(schema.apiKey)
    .where(eq(schema.apiKey.prefix, apiKeyPrefix(key)));
  const found = rows.find((row) => hashesMatch(row.hashedKey, candidate));
  if (found === undefined) throw rejection;
  if (found.revokedAt !== null) throw unauthorized('That API key has been revoked.');
  if (found.expiresAt !== null && found.expiresAt.getTime() <= now.getTime()) {
    throw unauthorized('That API key has expired.');
  }

  await db.update(schema.apiKey).set({ lastUsedAt: now }).where(eq(schema.apiKey.id, found.id));
  const principal = await resolvePrincipal(found.userId, found.organizationId);
  return { principal, apiKey: found };
}

export async function revokeApiKey(apiKeyId: string, now: Date = new Date()): Promise<ApiKeyRow> {
  const [row] = await db
    .update(schema.apiKey)
    .set({ revokedAt: now })
    .where(eq(schema.apiKey.id, apiKeyId))
    .returning();
  if (row === undefined) throw internal('That API key does not exist.');
  return row;
}
