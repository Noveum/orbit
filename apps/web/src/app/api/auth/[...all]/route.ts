import {
  bindAgentMcpCredential,
  bindMcpCredential,
  lockMcpOwner,
  unbindAgentMcpCredential,
  unbindMcpCredential,
  validateMcpGrant,
  verifyMcpTokenBinding,
} from '@orbit/core';
import { db, eq, schema, type Transaction } from '@orbit/db';
import { isDomainError } from '@orbit/shared/errors';
import {
  type McpTokenRequest,
  mcpAuthorizationCodeSchema,
  mcpCodeChallengeSchema,
  mcpCodeVerifierSchema,
  mcpTokenRequestSchema,
  mcpTokenResponseSchema,
} from '@orbit/shared/validators';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth, MCP_TOKEN_RATE_LIMIT_PROBE_HEADER } from '@/lib/auth/server.ts';
import { withSocketRevocation } from '@/lib/auth/sign-out.ts';
import { serverEnv } from '@/lib/env.ts';

const handlers = toNextJsHandler(auth.handler);

const MCP_AUTHORIZE_PATH = '/api/auth/mcp/authorize';
const MCP_TOKEN_PATH = '/api/auth/mcp/token';
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
}

function mcpTokenError(
  error: 'invalid_grant' | 'invalid_request' | 'server_error' | 'unsupported_grant_type',
  errorDescription: string,
  status: number,
): Response {
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

function issueMcpToken(request: Request, body: Record<string, unknown>): Promise<Response> {
  return auth.api.mcpOAuthToken({ request, headers: request.headers, body, asResponse: true });
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

async function authorizationCodeExchange(code: string): Promise<McpTokenExchange | null> {
  const [record] = await db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, code))
    .limit(1);
  if (record === undefined || record.expiresAt.getTime() <= Date.now()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(record.value) as unknown;
  } catch {
    return null;
  }
  const parsed = mcpAuthorizationCodeSchema.safeParse(raw);
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
      return {
        grantId: grant.id,
        kind: grant.identityKind,
        userId: grant.userId,
        clientId: grant.clientId,
        scopes: value.scope.join(' '),
        sourceRefreshToken: null,
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
      return {
        grantId: binding.grantId,
        kind,
        userId,
        clientId: source.clientId,
        scopes: source.scopes,
        sourceRefreshToken: binding.credential,
      };
    }),
  );
}

async function acceptIssuedMcpToken(
  exchange: McpTokenExchange,
  accessToken: string,
  refreshToken: string | undefined,
  responseScopes: string | undefined,
): Promise<string | null> {
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
      const source = await lockedRefreshSource(tx, exchange);
      if (exchange.sourceRefreshToken !== null && source === null) return null;
      const [issued] = await tx
        .select()
        .from(schema.oauthAccessToken)
        .where(eq(schema.oauthAccessToken.accessToken, accessToken))
        .limit(1)
        .for('update');
      if (
        issued === undefined ||
        !issuedTokenMatches(issued, exchange, refreshToken, responseScopes)
      ) {
        return null;
      }
      const scopes = issued.scopes;
      if (exchange.kind === 'agent' && !scopes.split(' ').includes('orbit.read')) return null;
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
    return null;
  });
}

function issuedTokenMatches(
  issued: typeof schema.oauthAccessToken.$inferSelect,
  exchange: McpTokenExchange,
  refreshToken: string | undefined,
  responseScopes: string | undefined,
): boolean {
  return (
    issued.clientId === exchange.clientId &&
    issued.userId === exchange.userId &&
    scopesWithin(issued.scopes, exchange.scopes) &&
    (responseScopes === undefined || scopesMatch(responseScopes, issued.scopes)) &&
    (refreshToken === undefined || issued.refreshToken === refreshToken) &&
    issued.accessTokenExpiresAt.getTime() > Date.now() &&
    (issued.mcpGrantId === null || issued.mcpGrantId === exchange.grantId)
  );
}

async function lockedRefreshSource(tx: Transaction, exchange: McpTokenExchange) {
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
    !scopesMatch(source.scopes, exchange.scopes) ||
    source.refreshTokenExpiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  await verifyMcpTokenBinding(tx, source, exchange.grantId, exchange.kind);
  return source;
}

async function secureMcpTokenResponse(
  response: Response,
  exchange: McpTokenExchange,
  secret: string,
): Promise<Response> {
  if (!response.ok) return response;
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
    return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
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
  if (rateLimitResponse !== null) return rateLimitResponse;
  const parsed = await parsedMcpTokenRequest(request);
  if (parsed === null)
    return mcpTokenError('invalid_request', 'The token request is invalid.', 400);
  if (
    parsed.body.grant_type !== 'authorization_code' &&
    parsed.body.grant_type !== 'refresh_token'
  ) {
    return mcpTokenError(
      'unsupported_grant_type',
      'The requested grant type is not supported.',
      400,
    );
  }
  const secret = serverEnv().BETTER_AUTH_SECRET;
  if (parsed.body.grant_type === 'authorization_code') {
    if (parsed.body.code === undefined) {
      return mcpTokenError('invalid_request', 'An authorization code is required.', 400);
    }
    if (!mcpCodeVerifierSchema.safeParse(parsed.body.code_verifier).success) {
      return mcpTokenError('invalid_request', 'The PKCE code verifier is invalid.', 400);
    }
    const exchange = await authorizationCodeExchange(parsed.body.code);
    if (exchange === null) {
      return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
    }
    return secureMcpTokenResponse(await issueMcpToken(request, parsed.body), exchange, secret);
  }
  if (parsed.body.refresh_token === undefined) {
    return mcpTokenError('invalid_request', 'A refresh token is required.', 400);
  }
  const exchange = await refreshExchange(parsed.body.refresh_token, secret);
  if (exchange === null || exchange.sourceRefreshToken === null) {
    return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
  }
  return secureMcpTokenResponse(
    await issueMcpToken(request, bodyWithRefreshToken(parsed, exchange.sourceRefreshToken)),
    exchange,
    secret,
  );
}

export function GET(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  if (url.pathname === MCP_AUTHORIZE_PATH) {
    const prompts = url.searchParams.getAll('prompt');
    if (prompts.length !== 1 || prompts[0] !== 'consent') {
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
  return handlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === MCP_TOKEN_PATH) return handleMcpTokenRequest(request);
  return withSocketRevocation(request, handlers.POST);
}
