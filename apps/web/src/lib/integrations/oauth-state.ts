import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { z } from 'zod';

export const OAUTH_STATE_TTL_MS = 600_000;

const providerSchema = z.enum(['github', 'slack']);
export type OAuthStateProvider = z.infer<typeof providerSchema>;

const payloadSchema = z.object({
  org: z.string().min(1),
  user: z.string().min(1),
  provider: providerSchema,
  exp: z.number().int().positive(),
  nonce: z.string().min(1),
});

export interface OAuthStateInput {
  readonly org: string;
  readonly user: string;
  readonly provider: OAuthStateProvider;
}

export interface OAuthState {
  readonly org: string;
  readonly user: string;
  readonly provider: OAuthStateProvider;
  readonly nonce: string;
}

export interface MintedOAuthState {
  readonly token: string;
  readonly nonce: string;
  readonly expiresAt: Date;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function mintOAuthState(
  input: OAuthStateInput,
  secret: string,
  now: Date = new Date(),
): MintedOAuthState {
  const nonce = randomUUIDv7();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS);
  const body = Buffer.from(
    JSON.stringify({
      org: input.org,
      user: input.user,
      provider: input.provider,
      exp: expiresAt.getTime(),
      nonce,
    }),
  ).toString('base64url');
  return { token: `${body}.${sign(body, secret)}`, nonce, expiresAt };
}

export function verifyOAuthState(
  token: string,
  secret: string,
  provider: OAuthStateProvider,
  now: Date = new Date(),
): OAuthState | null {
  const separator = token.indexOf('.');
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(body, secret);
  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length || !timingSafeEqual(received, computed)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) return null;
  if (parsed.data.provider !== provider) return null;
  if (parsed.data.exp <= now.getTime()) return null;
  return {
    org: parsed.data.org,
    user: parsed.data.user,
    provider: parsed.data.provider,
    nonce: parsed.data.nonce,
  };
}

export function integrationStateSecret(): string {
  return process.env['BETTER_AUTH_SECRET'] ?? '';
}
