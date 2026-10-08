import { DomainError } from '@orbit/shared/errors';
import { z } from 'zod';
import { decryptCredentialEnvelope, encryptCredentialEnvelope } from '../crypto/envelope.ts';

const INFO = 'orbit/slack/bot-token/v1';

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

function authenticatedData(input: SlackCredentialIdentity): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${input.organizationId}\u0000${input.integrationId}\u0000slack`);
}

export function encryptSlackBotToken(
  input: SlackCredentialIdentity & { readonly token: string },
): SlackCredentialEnvelope {
  return encryptCredentialEnvelope(input.token, INFO, authenticatedData(input), credentialError);
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

  return decryptCredentialEnvelope(parsed.data, INFO, authenticatedData(input), credentialError);
}

export function hasSlackBotToken(credentials: unknown): boolean {
  if (typeof credentials !== 'object' || credentials === null) return false;
  const token = (credentials as Record<string, unknown>)['botToken'];
  return (
    (typeof token === 'string' && token.length > 0) ||
    slackCredentialEnvelopeSchema.safeParse(token).success
  );
}
