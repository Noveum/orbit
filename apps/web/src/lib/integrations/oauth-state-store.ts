import { and, db, eq, gt, lt, schema } from '@orbit/db';
import {
  mintOAuthState,
  type OAuthState,
  type OAuthStateInput,
  type OAuthStateProvider,
  verifyOAuthState,
} from './oauth-state.ts';

export async function issueOAuthState(
  input: OAuthStateInput,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const minted = mintOAuthState(input, secret, now);
  await db
    .delete(schema.integrationOauthState)
    .where(lt(schema.integrationOauthState.expiresAt, now));
  await db.insert(schema.integrationOauthState).values({
    nonce: minted.nonce,
    provider: input.provider,
    organizationId: input.org,
    userId: input.user,
    expiresAt: minted.expiresAt,
  });
  return minted.token;
}

export async function consumeOAuthState(
  token: string,
  secret: string,
  provider: OAuthStateProvider,
  now: Date = new Date(),
): Promise<OAuthState | null> {
  const state = verifyOAuthState(token, secret, provider, now);
  if (state === null) return null;
  const consumed = await db
    .delete(schema.integrationOauthState)
    .where(
      and(
        eq(schema.integrationOauthState.nonce, state.nonce),
        eq(schema.integrationOauthState.provider, provider),
        eq(schema.integrationOauthState.organizationId, state.org),
        eq(schema.integrationOauthState.userId, state.user),
        gt(schema.integrationOauthState.expiresAt, now),
      ),
    )
    .returning({ nonce: schema.integrationOauthState.nonce });
  return consumed.length === 1 ? state : null;
}
