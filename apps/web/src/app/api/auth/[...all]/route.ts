import { bindMcpCredential, unbindMcpCredential } from '@orbit/core';
import { and, db, eq, isNull, schema } from '@orbit/db';
import { toNextJsHandler } from 'better-auth/next-js';
import { z } from 'zod';
import { auth, MCP_TOKEN_RATE_LIMIT_PROBE_HEADER } from '@/lib/auth/server.ts';
import { withSocketRevocation } from '@/lib/auth/sign-out.ts';
import { serverEnv } from '@/lib/env.ts';

const handlers = toNextJsHandler(auth.handler);

const MCP_AUTHORIZE_PATH = '/api/auth/mcp/authorize';
const MCP_TOKEN_PATH = '/api/auth/mcp/token';
const mcpCodeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const mcpCodeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

const mcpTokenRequestSchema = z
  .object({
    grant_type: z.string().min(1),
    code: z.string().min(1).optional(),
    code_verifier: z.string().optional(),
    refresh_token: z.string().min(1).optional(),
  })
  .catchall(z.string());

const mcpTokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

const mcpAuthorizationCodeSchema = z.object({ mcpGrantId: z.string().min(1) });

interface ParsedMcpTokenRequest {
  readonly body: z.infer<typeof mcpTokenRequestSchema>;
  readonly format: 'form' | 'json';
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

async function activeMcpGrant(grantId: string): Promise<boolean> {
  const [grant] = await db
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.id, grantId), isNull(schema.mcpGrant.revokedAt)))
    .limit(1);
  return grant !== undefined;
}

async function authorizationCodeGrantId(code: string): Promise<string | null> {
  const [record] = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, code))
    .limit(1);
  if (record === undefined) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(record.value) as unknown;
  } catch {
    return null;
  }
  const parsed = mcpAuthorizationCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data.mcpGrantId : null;
}

async function acceptIssuedMcpToken(
  grantId: string,
  accessToken: string,
  sourceRefreshToken: string | null,
): Promise<boolean> {
  if (sourceRefreshToken === null) {
    if (await activeMcpGrant(grantId)) return true;
    await db
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, accessToken));
    return false;
  }
  return await db.transaction(async (tx) => {
    const [consumed] = await tx
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.refreshToken, sourceRefreshToken))
      .returning({ id: schema.oauthAccessToken.id });
    if (consumed !== undefined) {
      const [grant] = await tx
        .select({ id: schema.mcpGrant.id })
        .from(schema.mcpGrant)
        .where(and(eq(schema.mcpGrant.id, grantId), isNull(schema.mcpGrant.revokedAt)))
        .limit(1);
      if (grant !== undefined) return true;
    }
    await tx
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, accessToken));
    return false;
  });
}

async function secureMcpTokenResponse(
  response: Response,
  grantId: string,
  secret: string,
  sourceRefreshToken: string | null,
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
  if (!(await acceptIssuedMcpToken(grantId, token.data.access_token, sourceRefreshToken))) {
    return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
  }
  const secured = {
    ...token.data,
    access_token: bindMcpCredential(token.data.access_token, grantId, secret),
    ...(token.data.refresh_token === undefined
      ? {}
      : { refresh_token: bindMcpCredential(token.data.refresh_token, grantId, secret) }),
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
    const grantId = await authorizationCodeGrantId(parsed.body.code);
    if (grantId === null || !(await activeMcpGrant(grantId))) {
      return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
    }
    return secureMcpTokenResponse(await issueMcpToken(request, parsed.body), grantId, secret, null);
  }
  if (parsed.body.refresh_token === undefined) {
    return mcpTokenError('invalid_request', 'A refresh token is required.', 400);
  }
  const binding = unbindMcpCredential(parsed.body.refresh_token, secret);
  if (binding === null || !(await activeMcpGrant(binding.grantId))) {
    return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
  }
  const [source] = await db
    .select({ id: schema.oauthAccessToken.id })
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.refreshToken, binding.credential))
    .limit(1);
  if (source === undefined) {
    return mcpTokenError('invalid_grant', 'Reconnect Orbit to continue.', 400);
  }
  return secureMcpTokenResponse(
    await issueMcpToken(request, bodyWithRefreshToken(parsed, binding.credential)),
    binding.grantId,
    secret,
    binding.credential,
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
