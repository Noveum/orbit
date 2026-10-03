import { DomainError } from '@orbit/shared/errors';
import { type AiCredentialEnvelope, aiCredentialEnvelopeSchema } from '@orbit/shared/validators';
import { decryptCredentialEnvelope, encryptCredentialEnvelope } from '../crypto/envelope.ts';

const INFO = 'orbit/ai/api-key/v1';

export interface AiCredentialIdentity {
  readonly organizationId: string;
}

export class AiCredentialUnavailableError extends DomainError {
  constructor(cause?: unknown) {
    super(
      'internal',
      'AI credentials could not be processed.',
      cause === undefined ? {} : { cause },
    );
    this.name = 'AiCredentialUnavailableError';
  }
}

function credentialError(cause?: unknown): AiCredentialUnavailableError {
  return new AiCredentialUnavailableError(cause);
}

function authenticatedData(input: AiCredentialIdentity): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${input.organizationId}\u0000ai`);
}

export function encryptAiApiKey(
  input: AiCredentialIdentity & { readonly apiKey: string },
): AiCredentialEnvelope {
  return encryptCredentialEnvelope(input.apiKey, INFO, authenticatedData(input), credentialError);
}

export function decryptAiApiKey(credentials: unknown, input: AiCredentialIdentity): string | null {
  if (typeof credentials !== 'object' || credentials === null) return null;
  const token = (credentials as Record<string, unknown>)['apiKey'];
  if (token === undefined) return null;

  const parsed = aiCredentialEnvelopeSchema.safeParse(token);
  if (!parsed.success) throw credentialError();

  return decryptCredentialEnvelope(parsed.data, INFO, authenticatedData(input), credentialError);
}

export function hasAiApiKey(credentials: unknown): boolean {
  if (typeof credentials !== 'object' || credentials === null) return false;
  const token = (credentials as Record<string, unknown>)['apiKey'];
  return aiCredentialEnvelopeSchema.safeParse(token).success;
}
