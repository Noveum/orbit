import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, db, desc, eq, gt, isNull, or, schema, sql, type Transaction } from '@orbit/db';
import { forbidden, notFound, unauthorized, validationFailed } from '@orbit/shared/errors';
import { assertMcpGrantOwner, type McpIdentity, type Principal } from '@orbit/shared/policy';
import { mcpConsentValueSchema } from '@orbit/shared/validators';
import { type Executor, newId } from '../internal.ts';
import { resolvePrincipal } from '../org/member-service.ts';

const MCP_CREDENTIAL_PREFIX = 'orbit-mcp-v1';
const AGENT_CREDENTIAL_PREFIX = 'orbit-mcp-agent-v2';
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

function bindCredential(
  credential: string,
  grantId: string,
  secret: string,
  prefix: string,
): string {
  const grant = encodedCredentialSegment(grantId);
  const token = encodedCredentialSegment(credential);
  const payload = `${prefix}.${grant}.${token}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function unbindCredential(
  credential: string,
  secret: string,
  prefix: string,
): McpCredentialBinding | null {
  if (credential.length > MAX_BOUND_CREDENTIAL_LENGTH || secret.length === 0) return null;
  const parts = credential.split('.');
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  const grant = parts[1];
  const token = parts[2];
  const signature = parts[3];
  if (grant === undefined || token === undefined || signature === undefined) return null;
  const expected = createHmac('sha256', secret)
    .update(`${prefix}.${grant}.${token}`)
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

export function bindMcpCredential(credential: string, grantId: string, secret: string): string {
  return bindCredential(credential, grantId, secret, MCP_CREDENTIAL_PREFIX);
}

export function unbindMcpCredential(
  credential: string,
  secret: string,
): McpCredentialBinding | null {
  return unbindCredential(credential, secret, MCP_CREDENTIAL_PREFIX);
}

export function bindAgentMcpCredential(
  credential: string,
  grantId: string,
  secret: string,
): string {
  return bindCredential(credential, grantId, secret, AGENT_CREDENTIAL_PREFIX);
}

export function unbindAgentMcpCredential(
  credential: string,
  secret: string,
): McpCredentialBinding | null {
  return unbindCredential(credential, secret, AGENT_CREDENTIAL_PREFIX);
}

export function isAgentMcpEnabled(): boolean {
  return process.env['ORBIT_AGENT_MCP'] === 'true';
}

export interface McpAccessContext {
  readonly identity: McpIdentity;
  readonly principal: Principal;
  readonly userId: string;
  readonly clientId: string;
  readonly organizationId: string;
  readonly scopes: string;
}

export async function lockMcpOwner(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`mcp-owner:${userId}`}, 0))`,
  );
}

export async function validateMcpGrant(
  tx: Transaction,
  grant: typeof schema.mcpGrant.$inferSelect,
  kind: 'legacy' | 'agent',
  _now: Date = new Date(),
): Promise<McpAccessContext> {
  const invalid = unauthorized('Reconnect Orbit to continue.');
  if (grant.revokedAt !== null || grant.identityKind !== kind) throw invalid;
  let identity: McpIdentity = { kind: 'legacy' };
  if (kind === 'agent') {
    if (!isAgentMcpEnabled() || grant.agentIdentityId === null || grant.ownerMemberId === null)
      throw invalid;
    const [membership] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, grant.ownerMemberId),
          eq(schema.member.userId, grant.userId),
          eq(schema.member.organizationId, grant.organizationId),
        ),
      )
      .limit(1)
      .for('share');
    if (membership === undefined) throw invalid;
    const [agent] = await tx
      .select()
      .from(schema.agentIdentity)
      .where(eq(schema.agentIdentity.id, grant.agentIdentityId))
      .limit(1);
    const [client] = await tx
      .select()
      .from(schema.oauthApplication)
      .where(eq(schema.oauthApplication.clientId, grant.clientId))
      .limit(1);
    if (
      agent === undefined ||
      agent.deletedAt !== null ||
      agent.ownerUserId !== grant.userId ||
      agent.clientId !== grant.clientId ||
      agent.organizationId !== grant.organizationId ||
      client === undefined ||
      client.disabled ||
      grant.scopes.split(/\s+/).includes('orbit.write')
    )
      throw invalid;
    identity = { kind: 'agent', id: agent.id, name: agent.name };
  } else if (grant.agentIdentityId !== null || grant.ownerMemberId !== null) {
    throw invalid;
  }
  const principal = await resolvePrincipal(grant.userId, grant.organizationId, tx);
  return {
    principal,
    identity,
    userId: grant.userId,
    clientId: grant.clientId,
    organizationId: grant.organizationId,
    scopes: grant.scopes,
  };
}

export async function verifyMcpTokenBinding(
  tx: Transaction,
  token: typeof schema.oauthAccessToken.$inferSelect,
  grantId: string,
  kind: 'legacy' | 'agent',
  now: Date = new Date(),
): Promise<McpAccessContext> {
  const invalid = unauthorized('That access token is not valid.');
  const [grant] = await tx
    .select()
    .from(schema.mcpGrant)
    .where(eq(schema.mcpGrant.id, grantId))
    .limit(1);
  if (
    grant === undefined ||
    token.clientId !== grant.clientId ||
    token.userId !== grant.userId ||
    (token.mcpGrantId !== grant.id && !(kind === 'legacy' && token.mcpGrantId === null))
  )
    throw invalid;
  const grantedScopes = new Set(grant.scopes.split(/\s+/).filter(Boolean));
  if (
    token.scopes
      .split(/\s+/)
      .filter(Boolean)
      .some((scope) => !grantedScopes.has(scope))
  )
    throw invalid;
  const context = await validateMcpGrant(tx, grant, kind, now);
  return { ...context, scopes: token.scopes };
}

export async function verifyMcpAccessToken(
  token: string,
  now: Date = new Date(),
): Promise<McpAccessContext> {
  const secret = process.env['BETTER_AUTH_SECRET'] ?? '';
  const legacy = unbindMcpCredential(token, secret);
  const binding = legacy ?? unbindAgentMcpCredential(token, secret);
  if (binding === null) throw unauthorized('That access token is not valid.');
  const kind = legacy === null ? 'agent' : 'legacy';
  const [source] = await db
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.accessToken, binding.credential))
    .limit(1);
  if (source?.userId == null) throw unauthorized('That access token is not valid.');
  const userId = source.userId;
  return db.transaction(async (tx) => {
    await lockMcpOwner(tx, userId);
    const [current] = await tx
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.id, source.id))
      .limit(1);
    if (current === undefined || current.accessTokenExpiresAt <= now)
      throw unauthorized('That access token has expired.');
    const context = await verifyMcpTokenBinding(tx, current, binding.grantId, kind, now);
    await tx
      .update(schema.mcpGrant)
      .set({ lastUsedAt: now })
      .where(eq(schema.mcpGrant.id, binding.grantId));
    return context;
  });
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
  executor: Transaction,
  input: RecordMcpGrantInput,
  now: Date = new Date(),
): Promise<string> {
  await lockMcpOwner(executor, input.userId);
  await resolvePrincipal(input.userId, input.organizationId, executor);
  const [previous] = await executor
    .select()
    .from(schema.mcpGrant)
    .where(
      and(
        eq(schema.mcpGrant.clientId, input.clientId),
        eq(schema.mcpGrant.userId, input.userId),
        eq(schema.mcpGrant.identityKind, 'legacy'),
      ),
    )
    .limit(1);
  const grantId = newId();
  await executor
    .delete(schema.oauthAccessToken)
    .where(
      and(
        eq(schema.oauthAccessToken.clientId, input.clientId),
        eq(schema.oauthAccessToken.userId, input.userId),
        or(
          isNull(schema.oauthAccessToken.mcpGrantId),
          eq(schema.oauthAccessToken.mcpGrantId, previous?.id ?? grantId),
        ),
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
      targetWhere: sql`${schema.mcpGrant.identityKind} = 'legacy'`,
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
  await db.transaction(async (tx) => {
    await lockMcpOwner(tx, userId);
    const [grant] = await tx
      .select()
      .from(schema.mcpGrant)
      .where(and(eq(schema.mcpGrant.id, id), eq(schema.mcpGrant.userId, userId)))
      .limit(1);
    if (grant === undefined) throw notFound('That connection does not exist.');
    assertMcpGrantOwner({ userId, organizationId: grant.organizationId }, grant);
    await invalidateMcpGrant(tx, grant, now);
  });
}

export async function invalidateMcpGrant(
  tx: Transaction,
  grant: typeof schema.mcpGrant.$inferSelect,
  now: Date = new Date(),
): Promise<void> {
  await tx.update(schema.mcpGrant).set({ revokedAt: now }).where(eq(schema.mcpGrant.id, grant.id));
  await tx
    .delete(schema.oauthAccessToken)
    .where(
      or(
        eq(schema.oauthAccessToken.mcpGrantId, grant.id),
        grant.identityKind === 'legacy'
          ? and(
              isNull(schema.oauthAccessToken.mcpGrantId),
              eq(schema.oauthAccessToken.clientId, grant.clientId),
              eq(schema.oauthAccessToken.userId, grant.userId),
            )
          : undefined,
      ),
    );
}

const CONSENT_CODE_TTL_MS = 600_000;

export async function getMcpConsentRequest(
  userId: string,
  consentCode: string,
  now: Date = new Date(),
  executor: Executor = db,
) {
  const invalid = unauthorized('This authorization request is invalid or has expired.');
  const [record] = await executor
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, consentCode))
    .limit(1)
    .for('update');
  if (record === undefined || record.expiresAt <= now) throw invalid;
  let raw: unknown;
  try {
    raw = JSON.parse(record.value);
  } catch {
    throw invalid;
  }
  const parsed = mcpConsentValueSchema.safeParse(raw);
  if (!parsed.success || parsed.data.requireConsent !== true) throw invalid;
  if (parsed.data.userId !== userId)
    throw forbidden('This authorization request belongs to another account.');
  return parsed.data;
}

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
  return await db.transaction(async (tx) => {
    await lockMcpOwner(tx, input.userId);
    const invalid = unauthorized('This authorization request is invalid or has expired.');
    const value = await getMcpConsentRequest(input.userId, input.consentCode, now, tx);

    const redirect = new URL(value.redirectURI);
    if (!input.accept) {
      await tx
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
        value: JSON.stringify({ ...value, requireConsent: false, mcpGrantId }),
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

    redirect.searchParams.set('code', code);
    if (value.state != null) redirect.searchParams.set('state', value.state);
    return {
      redirectUri: redirect.toString(),
      clientId: value.clientId,
      scope: value.scope.join(' '),
    };
  });
}
