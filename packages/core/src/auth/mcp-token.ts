import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, db, desc, eq, gt, inArray, isNull, schema } from '@orbit/db';
import { forbidden, notFound, unauthorized } from '@orbit/shared/errors';
import type { Principal } from '@orbit/shared/policy';
import type { AgentIdentitySelection } from '@orbit/shared/validators';
import { z } from 'zod';
import { type Executor, newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';
import { agentLifecycle, preparePersonalAgentConsent } from './agent-identity-service.ts';

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
    !timingSafeEqual(new Uint8Array(providedBytes), new Uint8Array(expectedBytes))
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
  readonly grantId: string;
  readonly agentIdentityId: string;
  readonly agentName: string;
  readonly agentAvatar: string | null;
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
    .select({
      token: schema.oauthAccessToken,
      grant: schema.mcpGrant,
      identity: schema.agentIdentity,
    })
    .from(schema.oauthAccessToken)
    .innerJoin(
      schema.mcpGrant,
      and(
        eq(schema.mcpGrant.id, binding.grantId),
        eq(schema.oauthAccessToken.mcpGrantId, binding.grantId),
      ),
    )
    .innerJoin(schema.agentIdentity, eq(schema.agentIdentity.id, schema.mcpGrant.agentIdentityId))
    .where(eq(schema.oauthAccessToken.accessToken, binding.credential))
    .limit(1);
  if (record === undefined) throw rejection;
  const tokenRow = record.token;
  if (tokenRow.accessTokenExpiresAt.getTime() <= now.getTime()) {
    throw unauthorized('That access token has expired.');
  }
  const grant = record.grant;
  if (tokenRow.userId === null || grant.userId === null || tokenRow.mcpGrantId !== grant.id) {
    throw rejection;
  }
  if (grant.revokedAt !== null) {
    throw unauthorized('This connection has been revoked. Reconnect Orbit to continue.', {
      details: { reason: 'grant_revoked' },
    });
  }
  const identity = record.identity;
  if (
    grant.agentIdentityId === null ||
    grant.agentIdentityId !== identity.id ||
    grant.clientId !== tokenRow.clientId ||
    grant.userId !== tokenRow.userId ||
    identity.ownerUserId !== grant.userId ||
    identity.organizationId !== grant.organizationId ||
    identity.clientId !== grant.clientId
  ) {
    throw unauthorized('This connection requires an agent identity.', {
      details: { reason: 'agent_identity_required' },
    });
  }
  if (identity.deletedAt !== null) {
    throw unauthorized('This agent has been deleted.', { details: { reason: 'agent_deleted' } });
  }
  if (agentLifecycle(identity) !== 'active') {
    throw unauthorized('This agent is inactive.', { details: { reason: 'agent_inactive' } });
  }
  const grantedScopes = new Set(grant.scopes.split(/\s+/).filter(Boolean));
  const tokenScopes = tokenRow.scopes.split(/\s+/).filter(Boolean);
  if (tokenScopes.some((scope) => !grantedScopes.has(scope))) {
    throw unauthorized("This connection's permissions have changed. Reconnect Orbit to continue.");
  }

  const principal = await resolvePrincipal(grant.userId, grant.organizationId);
  await db.update(schema.mcpGrant).set({ lastUsedAt: now }).where(eq(schema.mcpGrant.id, grant.id));

  return {
    principal,
    userId: grant.userId,
    clientId: tokenRow.clientId,
    organizationId: grant.organizationId,
    scopes: tokenRow.scopes,
    grantId: grant.id,
    agentIdentityId: identity.id,
    agentName: identity.name,
    agentAvatar: identity.avatar,
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
  readonly agentIdentityId?: string;
}

async function writeMcpGrant(
  executor: Executor,
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<string> {
  const grantId = newId();
  if (input.agentIdentityId !== undefined) {
    const active = await executor
      .select({ id: schema.mcpGrant.id })
      .from(schema.mcpGrant)
      .where(
        and(
          eq(schema.mcpGrant.agentIdentityId, input.agentIdentityId),
          isNull(schema.mcpGrant.revokedAt),
        ),
      )
      .for('update');
    const activeIds = active.map((grant) => grant.id);
    if (activeIds.length > 0) {
      await executor
        .update(schema.mcpGrant)
        .set({ revokedAt: now, revokeReason: 'grant_rotated' })
        .where(inArray(schema.mcpGrant.id, activeIds));
      await executor
        .delete(schema.oauthAccessToken)
        .where(inArray(schema.oauthAccessToken.mcpGrantId, activeIds));
    }
  }
  const [principal] = await executor
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, input.userId))
    .limit(1);
  if (principal === undefined) throw notFound('That person does not exist.');
  const [grant] = await executor
    .insert(schema.mcpGrant)
    .values({
      id: grantId,
      clientId: input.clientId,
      userId: input.userId,
      organizationId: input.organizationId,
      scopes: input.scopes,
      principalNameSnapshot: principal.name,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
      ...(input.agentIdentityId === undefined ? {} : { agentIdentityId: input.agentIdentityId }),
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

  await db
    .update(schema.mcpGrant)
    .set({ revokedAt: now, revokeReason: 'connection_revoked' })
    .where(eq(schema.mcpGrant.id, id));
  await db.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.mcpGrantId, id));
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
      readonly identitySelection: AgentIdentitySelection;
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

  const code = authorizationCode();
  await db.transaction(async (tx) => {
    const prepared = await preparePersonalAgentConsent(tx, {
      userId: input.userId,
      organizationId: input.organizationId,
      clientId: value.clientId,
      selection: input.identitySelection,
    });
    const mcpGrantId = await writeMcpGrant(
      tx,
      {
        clientId: value.clientId,
        userId: input.userId,
        organizationId: input.organizationId,
        scopes: value.scope.join(' '),
        agentIdentityId: prepared.identity.id,
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
