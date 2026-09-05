import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { DomainError, isDomainError } from '@orbit/shared/errors';
import { z } from 'zod';

const ALGORITHM = 'aes-256-gcm';
const INFO = 'orbit/slack/bot-token/v1';
const EMPTY_SALT = '';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

const slackCredentialEnvelopeSchema = z.object({
  version: z.literal(1),
  iv: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema,
  tag: base64UrlSchema.length(22),
});

export type SlackCredentialEnvelope = z.infer<typeof slackCredentialEnvelopeSchema>;

interface SlackCredentialIdentity {
  readonly organizationId: string;
  readonly integrationId: string;
}

export class SlackCredentialUnavailableError extends DomainError {
  constructor(cause?: unknown) {
    super(
      'internal',
      'Slack credentials could not be processed.',
      cause === undefined ? {} : { cause },
    );
    this.name = 'SlackCredentialUnavailableError';
  }
}

function credentialError(cause?: unknown): SlackCredentialUnavailableError {
  return new SlackCredentialUnavailableError(cause);
}

function encryptionKey(): Uint8Array<ArrayBuffer> {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (secret === undefined || secret.length === 0) throw credentialError();
  try {
    return new Uint8Array(hkdfSync('sha256', secret, EMPTY_SALT, INFO, 32));
  } catch (error) {
    throw credentialError(error);
  }
}

function authenticatedData(input: SlackCredentialIdentity): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${input.organizationId}\u0000${input.integrationId}\u0000slack`);
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Uint8Array.from(Buffer.from(value, 'base64url'));
  if (Buffer.from(decoded).toString('base64url') !== value) throw credentialError();
  return decoded;
}

function encodeBase64Url(value: Uint8Array<ArrayBufferLike>): string {
  return Buffer.from(value).toString('base64url');
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

export function encryptSlackBotToken(
  input: SlackCredentialIdentity & { readonly token: string },
): SlackCredentialEnvelope {
  try {
    const iv = Uint8Array.from(randomBytes(IV_BYTES));
    const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(authenticatedData(input));
    const ciphertext = joinBytes([
      Uint8Array.from(cipher.update(input.token, 'utf8')),
      Uint8Array.from(cipher.final()),
    ]);
    return {
      version: 1,
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(ciphertext),
      tag: encodeBase64Url(Uint8Array.from(cipher.getAuthTag())),
    };
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw credentialError(error);
  }
}

export function decryptSlackBotToken(
  credentials: unknown,
  input: SlackCredentialIdentity,
): string | null {
  if (typeof credentials !== 'object' || credentials === null) return null;
  const token = (credentials as Record<string, unknown>)['botToken'];
  if (typeof token === 'string') return token.length > 0 ? token : null;
  if (token === undefined) return null;
  const parsed = slackCredentialEnvelopeSchema.safeParse(token);
  if (!parsed.success) throw credentialError();
  try {
    const iv = decodeBase64Url(parsed.data.iv);
    const tag = decodeBase64Url(parsed.data.tag);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw credentialError();
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(authenticatedData(input));
    decipher.setAuthTag(tag);
    return new TextDecoder().decode(
      joinBytes([
        Uint8Array.from(decipher.update(decodeBase64Url(parsed.data.ciphertext))),
        Uint8Array.from(decipher.final()),
      ]),
    );
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw credentialError(error);
  }
}

export function hasSlackBotToken(credentials: unknown): boolean {
  if (typeof credentials !== 'object' || credentials === null) return false;
  const token = (credentials as Record<string, unknown>)['botToken'];
  return (
    (typeof token === 'string' && token.length > 0) ||
    slackCredentialEnvelopeSchema.safeParse(token).success
  );
}
