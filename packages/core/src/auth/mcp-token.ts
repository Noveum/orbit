import { and, db, desc, eq, gt, isNull, schema } from '@orbit/db';
import { notFound, unauthorized } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { newId } from '../internal.ts';
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

export async function recordMcpGrant(
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<void> {
  await db
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
