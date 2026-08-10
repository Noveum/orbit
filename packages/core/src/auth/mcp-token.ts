import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, db, desc, eq, gt, isNull, schema } from '@orbit/db';
import { forbidden, notFound, unauthorized, validationFailed } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';
import { type Executor, newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

const MCP_CREDENTIAL_PREFIX = 'orbit-mcp-v1';
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const MAX_BOUND_CREDENTIAL_LENGTH = 4096;

function encodedCredentialSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodedCredentialSegment(value: string): string | null {
  if (!BASE64URL_SEGMENT.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  return encodedCredentialSegment(decoded) === value && decoded.length > 0 ? decoded : null;
}

export interface McpCredentialBinding {
  readonly credential: string;
  readonly grantId: string;
}

export function bindMcpCredential(credential: string, grantId: string, secret: string): string {
  const grant = encodedCredentialSegment(grantId);
  const token = encodedCredentialSegment(credential);
  const payload = `${MCP_CREDENTIAL_PREFIX}.${grant}.${token}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function unbindMcpCredential(
  credential: string,
  secret: string,
): McpCredentialBinding | null {
  if (credential.length > MAX_BOUND_CREDENTIAL_LENGTH || secret.length === 0) return null;
  const parts = credential.split('.');
  if (parts.length !== 4 || parts[0] !== MCP_CREDENTIAL_PREFIX) return null;
  const grant = parts[1];
  const token = parts[2];
  const signature = parts[3];
  if (grant === undefined || token === undefined || signature === undefined) return null;
  const expected = createHmac('sha256', secret)
    .update(`${MCP_CREDENTIAL_PREFIX}.${grant}.${token}`)
    .digest('base64url');
  const providedBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return null;
  }
  const grantId = decodedCredentialSegment(grant);
  const rawCredential = decodedCredentialSegment(token);
  if (grantId === null || rawCredential === null) return null;
  return { credential: rawCredential, grantId };
}

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
  const binding = unbindMcpCredential(token, process.env['BETTER_AUTH_SECRET'] ?? '');
  if (binding === null) throw rejection;

  const [record] = await db
    .select({ token: schema.oauthAccessToken, grant: schema.mcpGrant })
    .from(schema.oauthAccessToken)
    .leftJoin(
      schema.mcpGrant,
      and(
        eq(schema.mcpGrant.id, binding.grantId),
        eq(schema.mcpGrant.clientId, schema.oauthAccessToken.clientId),
        eq(schema.mcpGrant.userId, schema.oauthAccessToken.userId),
      ),
    )
    .where(eq(schema.oauthAccessToken.accessToken, binding.credential))
    .limit(1);
  if (record === undefined) throw rejection;
  const tokenRow = record.token;
  if (tokenRow.accessTokenExpiresAt.getTime() <= now.getTime()) {
    throw unauthorized('That access token has expired.');
  }
  if (tokenRow.userId === null) throw rejection;

  const grant = record.grant;
  if (grant === null || grant.revokedAt !== null) {
    throw unauthorized('This connection has been revoked. Reconnect Orbit to continue.');
  }
  const grantedScopes = new Set(grant.scopes.split(/\s+/).filter(Boolean));
  const tokenScopes = tokenRow.scopes.split(/\s+/).filter(Boolean);
  if (tokenScopes.some((scope) => !grantedScopes.has(scope))) {
    throw unauthorized("This connection's permissions have changed. Reconnect Orbit to continue.");
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
): Promise<string> {
  const grantId = newId();
  await executor
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.clientId, input.clientId),
        eq(schema.oauthAccessToken.userId, input.userId),
      ),
    );
  const [grant] = await executor
    .insert(schema.mcpGrant)
    .values({
      id: grantId,
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
      set: {
        id: grantId,
        organizationId: input.organizationId,
        scopes: input.scopes,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      },
    })
    .returning({ id: schema.mcpGrant.id });
  if (grant === undefined) throw new Error('The MCP grant could not be stored.');
  return grant.id;
}

export async function recordMcpGrant(
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<string> {
  return await db.transaction((tx) => writeMcpGrant(tx, input, now));
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

export type FinalizeMcpConsentInput =
  | {
      readonly userId: string;
      readonly consentCode: string;
      readonly accept: false;
    }
  | {
      readonly userId: string;
      readonly consentCode: string;
      readonly accept: true;
      readonly organizationId: string;
    };

export async function finalizeMcpConsent(
  input: FinalizeMcpConsentInput,
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

  if (typeof input.organizationId !== 'string' || input.organizationId.length === 0) {
    throw validationFailed('Choose a workspace before approving this connection.');
  }

  const code = authorizationCode();
  await db.transaction(async (tx) => {
    const mcpGrantId = await writeMcpGrant(
      tx,
      {
        clientId: value.clientId,
        userId: input.userId,
        organizationId: input.organizationId,
        scopes: value.scope.join(' '),
      },
      now,
    );
    const [updated] = await tx
      .update(schema.verification)
      .set({
        identifier: code,
        value: JSON.stringify({ ...raw, requireConsent: false, mcpGrantId }),
        expiresAt: new Date(now.getTime() + CONSENT_CODE_TTL_MS),
      })
      .where(eq(schema.verification.identifier, input.consentCode))
      .returning({ id: schema.verification.id });
    if (updated === undefined) throw invalid;
    await tx.insert(schema.oauthConsent).values({
      id: newId(),
      clientId: value.clientId,
      userId: input.userId,
      scopes: value.scope.join(' '),
      consentGiven: true,
    });
  });

  redirect.searchParams.set('code', code);
  if (value.state != null) redirect.searchParams.set('state', value.state);
  return {
    redirectUri: redirect.toString(),
    clientId: value.clientId,
    scope: value.scope.join(' '),
  };
}
