import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { Database, Transaction } from '@orbit/db';
import { webhookDelivery, webhookDeliveryQuarantine } from '@orbit/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { GithubCheckNormalizationFailureCode } from './index.ts';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_VERSION = 1;
const PARSER_SCHEMA_VERSION = 1;
const KEY_INFO = 'orbit/github/webhook-quarantine/v1';
const EMPTY_SALT = '';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

const githubWebhookQuarantineEnvelopeSchema = z.object({
  version: z.literal(1),
  iv: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema,
  tag: base64UrlSchema.length(22),
});

const githubWebhookQuarantinePayloadSchema = z.object({
  version: z.literal(1),
  provider: z.literal('github'),
  eventName: z.string().min(1).max(255),
  providerDeliveryId: z.string().min(1).max(1024),
  rawPayload: z.string(),
});

export type GithubWebhookQuarantineEnvelope = z.infer<typeof githubWebhookQuarantineEnvelopeSchema>;
export type GithubWebhookQuarantinePayload = z.infer<typeof githubWebhookQuarantinePayloadSchema>;

type GithubQuarantineDatabase = Database | Transaction;

interface GithubWebhookQuarantineIdentity {
  readonly deliveryId: string;
  readonly provider: 'github';
  readonly providerDeliveryId: string;
}

export interface QuarantineGithubWebhookInput {
  readonly claim: {
    readonly id: string;
    readonly claimToken: string;
  };
  readonly rawPayload: string;
  readonly failure: {
    readonly code: GithubCheckNormalizationFailureCode;
    readonly path: string;
  };
  readonly now?: Date;
}

export class GithubWebhookQuarantineError extends Error {
  constructor() {
    super('GitHub webhook quarantine could not be processed.');
    this.name = 'GithubWebhookQuarantineError';
  }
}

function encryptionKey(): Uint8Array<ArrayBuffer> {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (secret === undefined || secret.length === 0) throw new GithubWebhookQuarantineError();
  try {
    return new Uint8Array(hkdfSync('sha256', secret, EMPTY_SALT, KEY_INFO, 32));
  } catch {
    throw new GithubWebhookQuarantineError();
  }
}

function authenticatedData(input: GithubWebhookQuarantineIdentity): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${input.deliveryId}\u0000${input.provider}\u0000${input.providerDeliveryId}\u0000github-webhook-quarantine`,
  );
}

function encodeBase64Url(value: Uint8Array<ArrayBufferLike>): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Uint8Array.from(Buffer.from(value, 'base64url'));
  if (Buffer.from(decoded).toString('base64url') !== value) {
    throw new GithubWebhookQuarantineError();
  }
  return decoded;
}

function joinBytes(parts: readonly Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function encryptGithubWebhookQuarantinePayload(
  payload: GithubWebhookQuarantinePayload,
  identity: GithubWebhookQuarantineIdentity,
): GithubWebhookQuarantineEnvelope {
  const parsed = githubWebhookQuarantinePayloadSchema.safeParse(payload);
  if (!parsed.success) throw new GithubWebhookQuarantineError();
  try {
    const iv = Uint8Array.from(randomBytes(IV_BYTES));
    const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(authenticatedData(identity));
    const ciphertext = joinBytes([
      Uint8Array.from(cipher.update(JSON.stringify(parsed.data), 'utf8')),
      Uint8Array.from(cipher.final()),
    ]);
    return {
      version: ENCRYPTION_KEY_VERSION,
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(ciphertext),
      tag: encodeBase64Url(Uint8Array.from(cipher.getAuthTag())),
    };
  } catch (error) {
    if (error instanceof GithubWebhookQuarantineError) throw error;
    throw new GithubWebhookQuarantineError();
  }
}

export function decryptGithubWebhookQuarantinePayload(
  envelope: unknown,
  identity: GithubWebhookQuarantineIdentity,
): GithubWebhookQuarantinePayload {
  const parsed = githubWebhookQuarantineEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new GithubWebhookQuarantineError();
  try {
    const iv = decodeBase64Url(parsed.data.iv);
    const tag = decodeBase64Url(parsed.data.tag);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new GithubWebhookQuarantineError();
    }
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(authenticatedData(identity));
    decipher.setAuthTag(tag);
    const plaintext = new TextDecoder().decode(
      joinBytes([
        Uint8Array.from(decipher.update(decodeBase64Url(parsed.data.ciphertext))),
        Uint8Array.from(decipher.final()),
      ]),
    );
    return githubWebhookQuarantinePayloadSchema.parse(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof GithubWebhookQuarantineError) throw error;
    throw new GithubWebhookQuarantineError();
  }
}

function scopeKeyHash(input: {
  readonly organizationId: string | null;
  readonly provider: string;
  readonly providerDeliveryId: string;
}): string {
  return createHash('sha256')
    .update(input.provider)
    .update('\u0000')
    .update(input.organizationId ?? '')
    .update('\u0000')
    .update(input.providerDeliveryId)
    .digest('hex');
}

async function atomic<T>(
  database: GithubQuarantineDatabase,
  operation: (tx: GithubQuarantineDatabase) => Promise<T>,
): Promise<T> {
  if ('$client' in database) return await database.transaction(operation);
  return await operation(database);
}

export async function quarantineGithubWebhookDelivery(
  database: GithubQuarantineDatabase,
  input: QuarantineGithubWebhookInput,
): Promise<typeof webhookDeliveryQuarantine.$inferSelect> {
  return await atomic(database, async (tx) => {
    const now = input.now ?? new Date();
    const finalized = await tx
      .update(webhookDelivery)
      .set({ status: 'quarantined', error: input.failure.code })
      .where(
        and(
          eq(webhookDelivery.id, input.claim.id),
          eq(webhookDelivery.provider, 'github'),
          eq(webhookDelivery.status, 'processing'),
          eq(webhookDelivery.claimToken, input.claim.claimToken),
        ),
      )
      .returning({
        id: webhookDelivery.id,
        provider: webhookDelivery.provider,
        providerDeliveryId: webhookDelivery.deliveryId,
        eventName: webhookDelivery.event,
        organizationId: webhookDelivery.organizationId,
      });
    const parent = finalized[0];
    if (parent === undefined || parent.provider !== 'github') {
      throw new GithubWebhookQuarantineError();
    }
    const identity = {
      deliveryId: parent.id,
      provider: 'github' as const,
      providerDeliveryId: parent.providerDeliveryId,
    };
    const payloadEnvelope = encryptGithubWebhookQuarantinePayload(
      {
        version: 1,
        provider: 'github',
        eventName: parent.eventName,
        providerDeliveryId: parent.providerDeliveryId,
        rawPayload: input.rawPayload,
      },
      identity,
    );
    const inserted = await tx
      .insert(webhookDeliveryQuarantine)
      .values({
        deliveryId: parent.id,
        organizationId: parent.organizationId,
        scopeKind: parent.organizationId === null ? 'unresolved' : 'organization',
        scopeKeyHash: scopeKeyHash({
          organizationId: parent.organizationId,
          provider: parent.provider,
          providerDeliveryId: parent.providerDeliveryId,
        }),
        payloadEnvelope,
        encryptionKeyVersion: ENCRYPTION_KEY_VERSION,
        parserSchemaVersion: PARSER_SCHEMA_VERSION,
        reasonCode: input.failure.code,
        reasonPath: input.failure.path,
        diagnostics: {
          eventName: parent.eventName,
          payloadBytes: Buffer.byteLength(input.rawPayload, 'utf8'),
          organizationAttributed: parent.organizationId !== null,
        },
        quarantinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const quarantine = inserted[0];
    if (quarantine === undefined) throw new GithubWebhookQuarantineError();
    return quarantine;
  });
}
