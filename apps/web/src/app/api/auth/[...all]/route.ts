import { decodeBasicCredentials } from '@better-auth/core/oauth2';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import {
  bindAgentMcpCredential,
  bindMcpCredential,
  lockMcpOwner,
  unbindAgentMcpCredential,
  unbindMcpCredential,
  validateMcpGrant,
  verifyMcpTokenBinding,
} from '@orbit/core';
import { and, db, eq, gt, isNotNull, isNull, schema, type Transaction } from '@orbit/db';
import { isDomainError } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  type McpTokenRequest,
  mcpAuthorizationCodeSchema,
  mcpCodeChallengeSchema,
  mcpCodeVerifierSchema,
  mcpProviderAuthorizationCodeSchema,
  mcpRevocationRequestSchema,
  mcpTokenRequestSchema,
  mcpTokenResponseSchema,
  mcpUnknownRevocationSchema,
  mcpUnsupportedRevocationSchema,
} from '@orbit/shared/validators';
import { toNextJsHandler } from 'better-auth/next-js';
import { decodeJwt } from 'jose';
import { forwardRequest } from '@/lib/auth/forward-request.ts';
import { providerClientRequest } from '@/lib/auth/mcp-client-auth.ts';
import { providerTokenHash } from '@/lib/auth/mcp-provider.ts';
import { isSafeMcpRedirectUri } from '@/lib/auth/mcp-redirect-uri.ts';
import { auth, MCP_TOKEN_RATE_LIMIT_PROBE_HEADER } from '@/lib/auth/server.ts';
import { withSocketRevocation } from '@/lib/auth/sign-out.ts';
import { mcpServerUrl, serverEnv } from '@/lib/env.ts';

const handlers = toNextJsHandler(auth.handler);
const providerResource = oauthProviderResourceClient(auth).getActions();

const MCP_AUTHORIZE_PATH = '/api/auth/mcp/authorize';
const MCP_TOKEN_PATH = '/api/auth/mcp/token';

function invalidMcpRedirect(): Response {
  const url = new URL('/api/auth/error', serverEnv().BETTER_AUTH_URL);
  url.searchParams.set('error', 'invalid_redirect_uri');
  return Response.redirect(url, 302);
}

async function providerAuthorizationResponse(request: Request): Promise<Response> {
  const response = await handlers.GET(request);
  const location = response.headers.get('location');
  if (location !== null && !isSafeMcpRedirectUri(new URL(location, request.url).toString()))
    return invalidMcpRedirect();
  return response;
}

function revocationClientId(request: Request, body: Record<string, unknown>): string | null {
  const authorization = request.headers.get('authorization');
  try {
    if (authorization !== null) return decodeBasicCredentials(authorization).clientId;
    if (typeof body['client_id'] === 'string' && body['client_id'].length > 0)
      return body['client_id'];
    if (typeof body['client_assertion'] !== 'string') return null;
    const assertion = decodeJwt(body['client_assertion']);
    return assertion.sub ?? assertion.iss ?? null;
  } catch {
    return null;
  }
}

async function revokeBoundAccessToken(
  credential: string,
  grantId: string,
  clientId: string,
): Promise<void> {
  const [token] = await db
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.accessToken, credential))
    .limit(1);
  if (
    token === undefined ||
    token.userId === null ||
    token.clientId !== clientId ||
    token.mcpGrantId !== grantId
  )
    return;
  const userId = token.userId;
  await db.transaction(async (tx) => {
    await lockMcpOwner(tx, userId);
    await tx
      .delete(schema.oauthAccessToken)
      .where(
        and(
          eq(schema.oauthAccessToken.id, token.id),
          eq(schema.oauthAccessToken.accessToken, credential),
          eq(schema.oauthAccessToken.clientId, clientId),
          eq(schema.oauthAccessToken.mcpGrantId, grantId),
        ),
      );
    await tx
      .delete(schema.oauthProviderAccessToken)
      .where(
        and(
          eq(schema.oauthProviderAccessToken.token, providerTokenHash(credential)),
          eq(schema.oauthProviderAccessToken.clientId, clientId),
          eq(schema.oauthProviderAccessToken.referenceId, grantId),
        ),
      );
  });
}

function emptyRevocationResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
  });
}

async function normalizeRevocationResponse(response: Response): Promise<Response> {
  if (response.status !== 400) return response;
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return mcpUnknownRevocationSchema.safeParse(payload).success
    ? emptyRevocationResponse()
    : response;
}

async function revokeMcpCredential(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = '/api/auth/oauth2/revoke';
  const original = await forwardRequest(url, request.clone());
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/x-www-form-urlencoded'
  ) {
    return normalizeRevocationResponse(await handlers.POST(original));
  }
  const parameters = new URLSearchParams(await request.clone().text());
  if ([...new Set(parameters.keys())].some((key) => parameters.getAll(key).length !== 1)) {
    return mcpTokenError('invalid_request', 'The revocation request is invalid.', 400);
  }
  const parsed = mcpRevocationRequestSchema.safeParse(Object.fromEntries(parameters));
  if (!parsed.success) return normalizeRevocationResponse(await handlers.POST(original));
  const secret = serverEnv().BETTER_AUTH_SECRET;
  const binding =
    unbindAgentMcpCredential(parsed.data.token, secret) ??
    unbindMcpCredential(parsed.data.token, secret);
  if (binding === null) return normalizeRevocationResponse(await handlers.POST(original));
  const prepared = await providerClientRequest(request, {
    ...parsed.data,
    token: binding.credential,
  });
  const response = await auth.api.oauth2Revoke({
    request: prepared.request,
    headers: prepared.request.headers,
    body: { ...prepared.body, token: binding.credential },
    asResponse: true,
  });
  if (response.status !== 400) return response;
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!mcpUnsupportedRevocationSchema.safeParse(payload).success)
    return normalizeRevocationResponse(response);
  const clientId = revocationClientId(prepared.request, prepared.body);
  if (clientId === null) return response;
  await revokeBoundAccessToken(binding.credential, binding.grantId, clientId);
  return emptyRevocationResponse();
}
interface ParsedMcpTokenRequest {
  readonly body: McpTokenRequest;
  readonly format: 'form' | 'json';
}

interface McpTokenExchange {
  readonly grantId: string;
  readonly kind: 'legacy' | 'agent';
  readonly userId: string;
  readonly clientId: string;
  readonly scopes: string;
  readonly sourceRefreshToken: string | null;
  readonly authorizationCodeId: string | null;
  readonly pendingTokenHash: string;
  readonly refreshId: string | null;
}

function pendingMcpTokenHash(authorizationCodeId: string): string {
  return providerTokenHash(`orbit-pending-code:${authorizationCodeId}`);
}

type TokenRejectionStage =
  | 'rate_limit_probe'
  | 'request_format'
  | 'unsupported_grant'
  | 'missing_code'
  | 'pkce_format'
  | 'authorization_code'
  | 'missing_refresh_token'
  | 'refresh_credential'
  | 'provider_exchange'
  | 'issued_token_binding';

function logTokenRejection(stage: TokenRejectionStage, status: number): void {
  if (status !== 400) return;
  console.info(JSON.stringify({ event: 'oauth.token.rejected', stage }));
}

function mcpTokenError(
  error: 'invalid_grant' | 'invalid_request' | 'server_error' | 'unsupported_grant_type',
  errorDescription: string,
  status: number,
  stage?: TokenRejectionStage,
): Response {
  if (stage !== undefined) logTokenRejection(stage, status);
  return Response.json(
    { error, error_description: errorDescription },
    { status, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
}

async function parsedMcpTokenRequest(request: Request): Promise<ParsedMcpTokenRequest | null> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  let raw: unknown;
  let format: ParsedMcpTokenRequest['format'];
  if (mediaType === 'application/x-www-form-urlencoded') {
    const search = new URLSearchParams(await request.clone().text());
    for (const key of new Set(search.keys())) {
      if (search.getAll(key).length !== 1) return null;
    }
    raw = Object.fromEntries(search);
    format = 'form';
  } else if (mediaType === 'application/json') {
    try {
      raw = JSON.parse(await request.clone().text()) as unknown;
    } catch {
      return null;
    }
    format = 'json';
  } else {
    return null;
  }
  const parsed = mcpTokenRequestSchema.safeParse(raw);
  return parsed.success ? { body: parsed.data, format } : null;
}

function bodyWithRefreshToken(parsed: ParsedMcpTokenRequest, refreshToken: string) {
  return { ...parsed.body, refresh_token: refreshToken };
}

async function applyMcpTokenRateLimit(request: Request): Promise<Response | null> {
  const headers = new Headers(request.headers);
  headers.set(MCP_TOKEN_RATE_LIMIT_PROBE_HEADER, '1');
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const response = await handlers.POST(
    new Request(request.url, { method: 'POST', headers, body: '{}' }),
  );
  return response.status === 204 ? null : response;
}

async function issueMcpToken(
  request: Request,
  body: { grant_type: string; [key: string]: unknown },
): Promise<Response> {
  const prepared = await providerClientRequest(request, {
    ...body,
    resource: body['resource'] ?? mcpServerUrl(),
  });
  const response = await authorizedBinding(() =>
    auth.api.oauth2Token({
      request: prepared.request,
      headers: prepared.request.headers,
      body: { ...prepared.body, grant_type: body.grant_type },
      asResponse: true,
    }),
  );
  return response ?? mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
}

function scopesMatch(left: string, right: string): boolean {
  const normalized = (scopes: string) => [...new Set(scopes.split(/\s+/).filter(Boolean))].sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function scopesWithin(requested: string, granted: string): boolean {
  const allowed = new Set(granted.split(/\s+/).filter(Boolean));
  return requested
    .split(/\s+/)
    .filter(Boolean)
    .every((scope) => allowed.has(scope));
}

async function authorizedBinding<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (isDomainError(error) && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

async function authorizationCodeExchange(
  code: string,
): Promise<McpTokenExchange | null | undefined> {
  const [record] = await db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, providerTokenHash(code)))
    .limit(1);
  if (record === undefined) return undefined;
  if (record.expiresAt.getTime() <= Date.now()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(record.value) as unknown;
  } catch {
    return null;
  }
  const provider = mcpProviderAuthorizationCodeSchema.safeParse(raw);
  if (!provider.success) return null;
  const parsed = mcpAuthorizationCodeSchema.safeParse({
    clientId: provider.data.query.client_id,
    redirectURI: provider.data.query.redirect_uri,
    scope: provider.data.query.scope.split(/\s+/).filter(Boolean),
    userId: provider.data.userId,
    requireConsent: false,
    mcpGrantId: provider.data.referenceId,
    codeChallenge: provider.data.query.code_challenge,
    codeChallengeMethod: provider.data.query.code_challenge_method,
  });
  if (!parsed.success) return null;
  const value = parsed.data;
  return authorizedBinding(() =>
    db.transaction(async (tx) => {
      await lockMcpOwner(tx, value.userId);
      const [grant] = await tx
        .select()
        .from(schema.mcpGrant)
        .where(eq(schema.mcpGrant.id, value.mcpGrantId))
        .limit(1);
      if (
        grant === undefined ||
        grant.clientId !== value.clientId ||
        grant.userId !== value.userId ||
        !scopesMatch(grant.scopes, value.scope.join(' ')) ||
        (grant.identityKind !== 'legacy' && grant.identityKind !== 'agent')
      ) {
        return null;
      }
      await validateMcpGrant(tx, grant, grant.identityKind);
      const authorizationCodeId = providerTokenHash(code);
      const pendingTokenHash = pendingMcpTokenHash(authorizationCodeId);
      await tx
        .insert(schema.oauthProviderAccessToken)
        .values({
          id: randomUUIDv7(),
          token: pendingTokenHash,
          clientId: value.clientId,
          userId: value.userId,
          sessionId: provider.data.sessionId,
          referenceId: grant.id,
          authorizationCodeId,
          resources: [mcpServerUrl()],
          scopes: value.scope,
          expiresAt: record.expiresAt,
          createdAt: new Date(),
          revoked: new Date(),
        })
        .onConflictDoNothing({ target: schema.oauthProviderAccessToken.token });
      return {
        grantId: grant.id,
        kind: grant.identityKind,
        userId: grant.userId,
        clientId: grant.clientId,
        scopes: value.scope.join(' '),
        sourceRefreshToken: null,
        authorizationCodeId,
        pendingTokenHash,
        refreshId: null,
      };
    }),
  );
}

async function refreshExchange(
  refreshToken: string,
  secret: string,
): Promise<McpTokenExchange | null> {
  const agentBinding = unbindAgentMcpCredential(refreshToken, secret);
  const binding = agentBinding ?? unbindMcpCredential(refreshToken, secret);
  if (binding === null) return null;
  const kind = agentBinding === null ? 'legacy' : 'agent';
  const [source] = await db
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.refreshToken, binding.credential))
    .limit(1);
  if (source === undefined || source.userId === null) return null;
  return authorizedBinding(() =>
    db.transaction(async (tx) => {
      const userId = source.userId;
      if (userId === null) return null;
      await lockMcpOwner(tx, userId);
      await verifyMcpTokenBinding(tx, source, binding.grantId, kind);
      if (source.refreshTokenExpiresAt.getTime() <= Date.now()) return null;
      const [family] = await tx
        .select()
        .from(schema.oauthProviderRefreshToken)
        .where(eq(schema.oauthProviderRefreshToken.token, providerTokenHash(binding.credential)))
        .limit(1)
        .for('share');
      if (
        family === undefined ||
        family.revoked !== null ||
        family.rotatedAt !== null ||
        family.expiresAt <= new Date() ||
        family.sessionId === null ||
        family.sessionId !== source.sessionId ||
        family.clientId !== source.clientId ||
        family.userId !== userId ||
        family.referenceId !== binding.grantId ||
        !scopesMatch(family.scopes.join(' '), source.scopes)
      )
        return null;
      const pendingTokenHash = providerTokenHash(`orbit-pending-refresh:${family.token}`);
      await tx
        .insert(schema.oauthProviderAccessToken)
        .values({
          id: randomUUIDv7(),
          token: pendingTokenHash,
          clientId: family.clientId,
          userId,
          sessionId: family.sessionId,
          referenceId: binding.grantId,
          authorizationCodeId: family.authorizationCodeId,
          refreshId: family.id,
          resources: [mcpServerUrl()],
          scopes: family.scopes,
          expiresAt: family.expiresAt,
          createdAt: new Date(),
          revoked: new Date(),
        })
        .onConflictDoNothing({ target: schema.oauthProviderAccessToken.token });
      return {
        grantId: binding.grantId,
        kind,
        userId,
        clientId: source.clientId,
        scopes: source.scopes,
        sourceRefreshToken: binding.credential,
        authorizationCodeId: family.authorizationCodeId,
        pendingTokenHash,
        refreshId: family.id,
      };
    }),
  );
}

async function issuedProviderState(
  tx: Transaction,
  exchange: McpTokenExchange,
  sessionId: string,
  refreshToken: string | undefined,
) {
  const [session] = await tx
    .select()
    .from(schema.session)
    .where(eq(schema.session.id, sessionId))
    .limit(1)
    .for('share');
  if (
    session === undefined ||
    session.userId !== exchange.userId ||
    session.expiresAt <= new Date()
  )
    return null;
  const [refresh] =
    refreshToken === undefined
      ? []
      : await tx
          .select()
          .from(schema.oauthProviderRefreshToken)
          .where(eq(schema.oauthProviderRefreshToken.token, providerTokenHash(refreshToken)))
          .limit(1)
          .for('share');
  if (
    refreshToken !== undefined &&
    (refresh === undefined ||
      refresh.revoked !== null ||
      refresh.rotatedAt !== null ||
      refresh.expiresAt <= new Date() ||
      refresh.userId !== exchange.userId ||
      refresh.clientId !== exchange.clientId ||
      refresh.referenceId !== exchange.grantId ||
      refresh.sessionId !== session.id)
  )
    return null;

  return { session, refresh };
}

async function persistIssuedMcpToken(
  tx: Transaction,
  exchange: McpTokenExchange,
  accessToken: string,
  refreshToken: string | undefined,
  payload: Awaited<ReturnType<typeof providerResource.verifyBearerToken>>,
  { session, refresh }: NonNullable<Awaited<ReturnType<typeof issuedProviderState>>>,
) {
  const pending = and(
    eq(schema.oauthProviderAccessToken.token, exchange.pendingTokenHash),
    exchange.authorizationCodeId === null
      ? isNull(schema.oauthProviderAccessToken.authorizationCodeId)
      : eq(schema.oauthProviderAccessToken.authorizationCodeId, exchange.authorizationCodeId),
    exchange.refreshId === null
      ? isNull(schema.oauthProviderAccessToken.refreshId)
      : eq(schema.oauthProviderAccessToken.refreshId, exchange.refreshId),
    eq(schema.oauthProviderAccessToken.clientId, exchange.clientId),
    eq(schema.oauthProviderAccessToken.userId, exchange.userId),
    eq(schema.oauthProviderAccessToken.sessionId, session.id),
    eq(schema.oauthProviderAccessToken.referenceId, exchange.grantId),
    isNotNull(schema.oauthProviderAccessToken.revoked),
    gt(schema.oauthProviderAccessToken.expiresAt, new Date()),
  );
  if (refreshToken === undefined) {
    const tracked = await tx
      .update(schema.oauthProviderAccessToken)
      .set({
        token: providerTokenHash(accessToken),
        expiresAt: new Date((payload.exp ?? 0) * 1000),
        scopes: String(payload['scope']).split(/\s+/).filter(Boolean),
        revoked: null,
      })
      .where(pending)
      .returning({ id: schema.oauthProviderAccessToken.id });
    if (tracked.length !== 1) return [];
  } else {
    const consumed = await tx
      .delete(schema.oauthProviderAccessToken)
      .where(pending)
      .returning({ id: schema.oauthProviderAccessToken.id });
    if (consumed.length !== 1) return [];
  }
  return tx
    .insert(schema.oauthAccessToken)
    .values({
      id: randomUUIDv7(),
      accessToken,
      refreshToken: refreshToken ?? randomUUIDv7(),
      clientId: exchange.clientId,
      userId: exchange.userId,
      mcpGrantId: exchange.grantId,
      sessionId: session.id,
      scopes: String(payload['scope']),
      accessTokenExpiresAt: new Date((payload.exp ?? 0) * 1000),
      refreshTokenExpiresAt: refresh?.expiresAt ?? new Date(),
    })
    .returning();
}

async function acceptIssuedMcpToken(
  exchange: McpTokenExchange,
  accessToken: string,
  refreshToken: string | undefined,
  responseScopes: string | undefined,
): Promise<string | null> {
  const payload = await providerResource
    .verifyBearerToken(accessToken, {
      verifyOptions: {
        issuer: new URL(serverEnv().BETTER_AUTH_URL).origin,
        audience: mcpServerUrl(),
      },
    })
    .catch(() => null);
  if (
    payload === null ||
    payload.sub !== exchange.userId ||
    payload['client_id'] !== exchange.clientId ||
    payload['orbit_grant_id'] !== exchange.grantId ||
    typeof payload['sid'] !== 'string' ||
    typeof payload['scope'] !== 'string' ||
    typeof payload.exp !== 'number'
  )
    return null;
  return await db.transaction(async (tx) => {
    await lockMcpOwner(tx, exchange.userId);
    const accepted = await authorizedBinding(async () => {
      const [grant] = await tx
        .select()
        .from(schema.mcpGrant)
        .where(eq(schema.mcpGrant.id, exchange.grantId))
        .limit(1);
      if (grant === undefined) return null;
      await validateMcpGrant(tx, grant, exchange.kind);
      const source = await lockedRefreshSourceAfterRotation(tx, exchange);
      if (exchange.sourceRefreshToken !== null && source === null) return null;
      const state = await issuedProviderState(tx, exchange, String(payload['sid']), refreshToken);
      if (state === null) return null;
      const [issued] = await persistIssuedMcpToken(
        tx,
        exchange,
        accessToken,
        refreshToken,
        payload,
        state,
      );
      if (!issuedTokenMatches(issued, exchange, refreshToken, responseScopes)) {
        return null;
      }
      const scopes = issued.scopes;
      await tx
        .update(schema.oauthAccessToken)
        .set({ mcpGrantId: exchange.grantId })
        .where(eq(schema.oauthAccessToken.id, issued.id));
      await verifyMcpTokenBinding(
        tx,
        { ...issued, mcpGrantId: exchange.grantId, scopes },
        exchange.grantId,
        exchange.kind,
      );
      if (source !== null) {
        await tx.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.id, source.id));
      }
      return scopes;
    });
    if (accepted !== null) return accepted;
    await tx
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, accessToken));
    await tx
      .delete(schema.oauthProviderAccessToken)
      .where(
        and(
          eq(schema.oauthProviderAccessToken.token, providerTokenHash(accessToken)),
          eq(schema.oauthProviderAccessToken.clientId, exchange.clientId),
          eq(schema.oauthProviderAccessToken.referenceId, exchange.grantId),
        ),
      );
    return null;
  });
}

function issuedTokenMatches(
  issued: typeof schema.oauthAccessToken.$inferSelect | undefined,
  exchange: McpTokenExchange,
  refreshToken: string | undefined,
  responseScopes: string | undefined,
): issued is typeof schema.oauthAccessToken.$inferSelect {
  return (
    issued !== undefined &&
    (exchange.kind !== 'agent' || issued.scopes.split(' ').includes('orbit.read')) &&
    issued.clientId === exchange.clientId &&
    issued.userId === exchange.userId &&
    scopesWithin(issued.scopes, exchange.scopes) &&
    (responseScopes === undefined || scopesMatch(responseScopes, issued.scopes)) &&
    (refreshToken === undefined || issued.refreshToken === refreshToken) &&
    issued.accessTokenExpiresAt.getTime() > Date.now() &&
    (issued.mcpGrantId === null || issued.mcpGrantId === exchange.grantId)
  );
}

async function lockedRefreshSourceAfterRotation(tx: Transaction, exchange: McpTokenExchange) {
  if (exchange.sourceRefreshToken === null) return null;
  const [source] = await tx
    .select()
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.refreshToken, exchange.sourceRefreshToken))
    .limit(1)
    .for('update');
  if (
    source === undefined ||
    source.userId !== exchange.userId ||
    source.clientId !== exchange.clientId ||
    (source.mcpGrantId !== exchange.grantId &&
      !(exchange.kind === 'legacy' && source.mcpGrantId === null)) ||
    !scopesMatch(source.scopes, exchange.scopes) ||
    source.refreshTokenExpiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  return source;
}

async function secureMcpTokenResponse(
  response: Response,
  exchange: McpTokenExchange,
  secret: string,
): Promise<Response> {
  if (!response.ok) {
    logTokenRejection('provider_exchange', response.status);
    return response;
  }
  let raw: unknown;
  try {
    raw = (await response.clone().json()) as unknown;
  } catch {
    return mcpTokenError('server_error', 'The token response could not be secured.', 500);
  }
  const token = mcpTokenResponseSchema.safeParse(raw);
  if (!token.success) {
    return mcpTokenError('server_error', 'The token response could not be secured.', 500);
  }
  const scopes = await acceptIssuedMcpToken(
    exchange,
    token.data.access_token,
    token.data.refresh_token,
    token.data.scope,
  );
  if (scopes === null) {
    return mcpTokenError(
      'invalid_grant',
      'Reconnect Orbit to continue.',
      400,
      'issued_token_binding',
    );
  }
  const bind = exchange.kind === 'agent' ? bindAgentMcpCredential : bindMcpCredential;
  const secured = {
    ...token.data,
    scope: scopes,
    access_token: bind(token.data.access_token, exchange.grantId, secret),
    ...(token.data.refresh_token === undefined
      ? {}
      : { refresh_token: bind(token.data.refresh_token, exchange.grantId, secret) }),
  };
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  return new Response(JSON.stringify(secured), { status: response.status, headers });
}

async function handleMcpTokenRequest(request: Request): Promise<Response> {
  const rateLimitResponse = await applyMcpTokenRateLimit(request);
  if (rateLimitResponse !== null) {
    logTokenRejection('rate_limit_probe', rateLimitResponse.status);
    return rateLimitResponse;
  }
  const parsed = await parsedMcpTokenRequest(request);
  if (parsed === null)
    return mcpTokenError('invalid_request', 'The token request is invalid.', 400, 'request_format');
  if (
    parsed.body.grant_type !== 'authorization_code' &&
    parsed.body.grant_type !== 'refresh_token'
  ) {
    return mcpTokenError(
      'unsupported_grant_type',
      'The requested grant type is not supported.',
      400,
      'unsupported_grant',
    );
  }
  const secret = serverEnv().BETTER_AUTH_SECRET;
  if (parsed.body.grant_type === 'authorization_code') {
    if (parsed.body.code === undefined) {
      return mcpTokenError(
        'invalid_request',
        'An authorization code is required.',
        400,
        'missing_code',
      );
    }
    if (!mcpCodeVerifierSchema.safeParse(parsed.body.code_verifier).success) {
      return mcpTokenError(
        'invalid_request',
        'The PKCE code verifier is invalid.',
        400,
        'pkce_format',
      );
    }
    const exchange = await authorizationCodeExchange(parsed.body.code);
    if (exchange === null || exchange === undefined) {
      if (exchange === undefined) await issueMcpToken(request, parsed.body);
      return mcpTokenError(
        'invalid_grant',
        'Reconnect Orbit to continue.',
        400,
        'authorization_code',
      );
    }
    return secureMcpTokenResponse(await issueMcpToken(request, parsed.body), exchange, secret);
  }
  if (parsed.body.refresh_token === undefined) {
    return mcpTokenError(
      'invalid_request',
      'A refresh token is required.',
      400,
      'missing_refresh_token',
    );
  }
  const exchange = await refreshExchange(parsed.body.refresh_token, secret);
  if (exchange === null || exchange.sourceRefreshToken === null) {
    return mcpTokenError(
      'invalid_grant',
      'Reconnect Orbit to continue.',
      400,
      'refresh_credential',
    );
  }
  return secureMcpTokenResponse(
    await issueMcpToken(request, bodyWithRefreshToken(parsed, exchange.sourceRefreshToken)),
    exchange,
    secret,
  );
}

export function GET(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  if (url.pathname === MCP_AUTHORIZE_PATH || url.pathname === '/api/auth/oauth2/authorize') {
    const callbacks = url.searchParams.getAll('redirect_uri');
    if (
      callbacks.length > 1 ||
      (callbacks[0] !== undefined && !isSafeMcpRedirectUri(callbacks[0])) ||
      url.searchParams.getAll('client_id').length > 1
    )
      return invalidMcpRedirect();
    const prompts = url.searchParams.getAll('prompt');
    if (prompts.length === 0 && !url.searchParams.has('sig')) {
      url.searchParams.set('prompt', 'consent');
    } else if (prompts.length !== 1 || prompts[0] !== 'consent') {
      return Response.json(
        { error: 'invalid_request', error_description: 'Explicit consent is required.' },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }
    const challenges = url.searchParams.getAll('code_challenge');
    if (
      challenges.length > 0 &&
      (challenges.length !== 1 || !mcpCodeChallengeSchema.safeParse(challenges[0]).success)
    ) {
      return Response.json(
        { error: 'invalid_request', error_description: 'The PKCE code challenge is invalid.' },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }
  }
  if (url.pathname.startsWith('/api/auth/mcp/')) {
    url.pathname = url.pathname.replace('/api/auth/mcp/', '/api/auth/oauth2/');
    return forwardRequest(url, request).then(providerAuthorizationResponse);
  }
  if (url.pathname === '/api/auth/oauth2/authorize')
    return forwardRequest(url, request).then(providerAuthorizationResponse);
  return forwardRequest(url, request).then((forwarded) => handlers.GET(forwarded));
}

export function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/auth/oauth2/revoke' || url.pathname === '/api/auth/mcp/revoke') {
    return revokeMcpCredential(request);
  }
  if (url.pathname === MCP_TOKEN_PATH || url.pathname === '/api/auth/oauth2/token') {
    return handleMcpTokenRequest(request);
  }
  if (url.pathname.startsWith('/api/auth/mcp/')) {
    url.pathname = url.pathname.replace('/api/auth/mcp/', '/api/auth/oauth2/');
    return forwardRequest(url, request).then((forwarded) =>
      withSocketRevocation(forwarded, handlers.POST),
    );
  }
  return withSocketRevocation(request, handlers.POST);
}
