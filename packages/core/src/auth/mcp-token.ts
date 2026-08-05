import { randomBytes } from 'node:crypto';
import { and, db, desc, eq, gt, isNull, schema } from '@orbit/db';
import { forbidden, notFound, unauthorized } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { type Executor, newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

export interface McpAccessContext {
  readonly principal: Principal;
  readonly userId: string;
  readonly clientId: string;
  readonly organizationId: string;
  readonly scopes: string;
}

export async function verifyMcpAccessToken(
  token: string,
  now: Date = new Date(),
): Promise<McpAccessContext> {
  const rejection = unauthorized('That access token is not valid.');
  if (token.trim().length === 0) throw rejection;

  const [tokenRow] = await db
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.accessToken, token))
    .limit(1);
  if (tokenRow === undefined) throw rejection;
  if (tokenRow.accessTokenExpiresAt.getTime() <= now.getTime()) {
    throw unauthorized('That access token has expired.');
  }
  if (tokenRow.userId === null) throw rejection;

  const [grant] = await db
    .select()
    .from(schema.mcpGrant)
    .where(
      and(
        eq(schema.mcpGrant.clientId, tokenRow.clientId),
        eq(schema.mcpGrant.userId, tokenRow.userId),
        isNull(schema.mcpGrant.revokedAt),
      ),
    )
    .limit(1);
  if (grant === undefined) {
    throw unauthorized('This connection has been revoked. Reconnect Orbit to continue.');
  }

  const principal = await resolvePrincipal(tokenRow.userId, grant.organizationId);
  await db.update(schema.mcpGrant).set({ lastUsedAt: now }).where(eq(schema.mcpGrant.id, grant.id));

  return {
    principal,
    userId: tokenRow.userId,
    clientId: tokenRow.clientId,
    organizationId: grant.organizationId,
    scopes: tokenRow.scopes,
  };
}

export interface McpClient {
  readonly clientId: string;
  readonly name: string;
  readonly icon: string | null;
}

export async function getMcpClient(clientId: string): Promise<McpClient | null> {
  const [row] = await db
    .select({
      clientId: schema.oauthApplication.clientId,
      name: schema.oauthApplication.name,
      icon: schema.oauthApplication.icon,
    })
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function userHasPasskey(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.passkey.id })
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, userId))
    .limit(1);
  return row !== undefined;
}

export async function passkeyVerifiedWithin(
  userId: string,
  windowMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  const threshold = new Date(now.getTime() - windowMs);
  const [row] = await db
    .select({ lastUsedAt: schema.passkey.lastUsedAt })
    .from(schema.passkey)
    .where(and(eq(schema.passkey.userId, userId), gt(schema.passkey.lastUsedAt, threshold)))
    .limit(1);
  return row !== undefined;
}

export interface RecordMcpGrantInput {
  readonly clientId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly scopes: string;
}

async function writeMcpGrant(
  executor: Executor,
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<void> {
  await executor
    .insert(schema.mcpGrant)
    .values({
      id: newId(),
      clientId: input.clientId,
      userId: input.userId,
      organizationId: input.organizationId,
      scopes: input.scopes,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [schema.mcpGrant.clientId, schema.mcpGrant.userId],
      set: { organizationId: input.organizationId, scopes: input.scopes, revokedAt: null },
    });
}

export async function recordMcpGrant(
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<void> {
  await writeMcpGrant(db, input, now);
}

export interface McpGrantView {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly scopes: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export function listMcpGrants(userId: string): Promise<McpGrantView[]> {
  return db
    .select({
      id: schema.mcpGrant.id,
      clientId: schema.mcpGrant.clientId,
      clientName: schema.oauthApplication.name,
      organizationId: schema.mcpGrant.organizationId,
      organizationName: schema.organization.name,
      scopes: schema.mcpGrant.scopes,
      createdAt: schema.mcpGrant.createdAt,
      lastUsedAt: schema.mcpGrant.lastUsedAt,
    })
    .from(schema.mcpGrant)
    .innerJoin(
      schema.oauthApplication,
      eq(schema.oauthApplication.clientId, schema.mcpGrant.clientId),
    )
    .innerJoin(schema.organization, eq(schema.organization.id, schema.mcpGrant.organizationId))
    .where(and(eq(schema.mcpGrant.userId, userId), isNull(schema.mcpGrant.revokedAt)))
    .orderBy(desc(schema.mcpGrant.createdAt));
}

export async function revokeMcpGrant(
  id: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const [grant] = await db
    .select()
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.id, id), eq(schema.mcpGrant.userId, userId)))
    .limit(1);
  if (grant === undefined) throw notFound('That connection does not exist.');

  await db.update(schema.mcpGrant).set({ revokedAt: now }).where(eq(schema.mcpGrant.id, id));
  await db
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.clientId, grant.clientId),
        eq(schema.oauthAccessToken.userId, userId),
      ),
    );
}

const CONSENT_CODE_TTL_MS = 600_000;

const mcpConsentValueSchema = z.object({
  clientId: z.string().min(1),
  redirectURI: z.string().min(1),
  scope: z.array(z.string()),
  userId: z.string().min(1),
  requireConsent: z.boolean().optional(),
  state: z.string().nullable().optional(),
});

function authorizationCode(): string {
  return randomBytes(24).toString('base64url');
}

export interface FinalizeMcpConsentInput {
  readonly userId: string;
  readonly consentCode: string;
  readonly accept: boolean;
}

export interface FinalizeMcpConsentInput2 {
  readonly organizationId?: string;
}

export async function finalizeMcpConsent(
  input: FinalizeMcpConsentInput & FinalizeMcpConsentInput2,
  now: Date = new Date(),
): Promise<{ redirectUri: string; clientId: string; scope: string }> {
  const invalid = unauthorized('This authorization request is invalid or has expired.');

  const [record] = await db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, input.consentCode))
    .limit(1);
  if (record === undefined) throw invalid;
  if (record.expiresAt.getTime() <= now.getTime()) throw invalid;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(record.value) as Record<string, unknown>;
  } catch {
    throw invalid;
  }
  const value = mcpConsentValueSchema.parse(raw);
  if (value.userId !== input.userId) {
    throw forbidden('This authorization request belongs to another account.');
  }
  if (value.requireConsent !== true) throw invalid;

  const redirect = new URL(value.redirectURI);
  if (!input.accept) {
    await db
      .delete(schema.verification)
      .where(eq(schema.verification.identifier, input.consentCode));
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'User denied access');
    if (value.state != null) redirect.searchParams.set('state', value.state);
    return {
      redirectUri: redirect.toString(),
      clientId: value.clientId,
      scope: value.scope.join(' '),
    };
  }

  const code = authorizationCode();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.verification)
      .set({
        identifier: code,
        value: JSON.stringify({ ...raw, requireConsent: false }),
        expiresAt: new Date(now.getTime() + CONSENT_CODE_TTL_MS),
      })
      .where(eq(schema.verification.identifier, input.consentCode));
    await tx.insert(schema.oauthConsent).values({
      id: newId(),
      clientId: value.clientId,
      userId: input.userId,
      scopes: value.scope.join(' '),
      consentGiven: true,
    });
    if (input.organizationId !== undefined) {
      await writeMcpGrant(tx, {
        clientId: value.clientId,
        userId: input.userId,
        organizationId: input.organizationId,
        scopes: value.scope.join(' '),
      });
    }
  });

  redirect.searchParams.set('code', code);
  if (value.state != null) redirect.searchParams.set('state', value.state);
  return {
    redirectUri: redirect.toString(),
    clientId: value.clientId,
    scope: value.scope.join(' '),
  };
}
