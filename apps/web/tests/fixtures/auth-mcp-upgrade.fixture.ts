import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { db, eq, pool, schema, sql } from '@orbit/db';
import { isValidElement } from 'react';
import { z } from 'zod';

const database = new URL(process.env['DATABASE_URL'] ?? 'http://invalid');
const mode = z
  .enum([
    'grant',
    'provider-revoke',
    'replay',
    'session',
    'session-read',
    'migration',
    'legacy-public',
    'legacy-basic',
    'legacy-post',
    'foreign-resource',
    'legacy-unlink',
    'legacy-no-resource',
    'legacy-late-public',
    'legacy-late-basic',
    'legacy-late-post',
    'legacy-late-disabled',
    'legacy-late-invalid',
    'legacy-post-wrong',
    'modern-basic',
    'modern-basic-post',
  ])
  .parse(process.argv[2] ?? 'grant');
if (
  !(
    ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) &&
    /^\/orbit_test_web(?:_[a-z0-9]+)?$/.test(database.pathname)
  )
) {
  throw new Error('The auth fixture requires an explicit loopback web test database.');
}
const [actual] = await db.execute<{ name: string }>(sql`select current_database() as name`);
assert.equal(actual?.['name'], database.pathname.slice(1));
await resetDatabase();
const workspace = await createWorkspace('auth-security');
const sessionToken = randomUUID();
await db.insert(schema.session).values({
  id: randomUUID(),
  token: sessionToken,
  userId: workspace.adminUser.id,
  activeOrganizationId: workspace.organizationId,
  expiresAt: new Date(Date.now() + 3_600_000),
});
const signature = createHmac('sha256', process.env['BETTER_AUTH_SECRET'] ?? '')
  .update(sessionToken)
  .digest('base64');
const cookie = `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`;
const origin = 'http://localhost:3000';
const headers = new Headers({ origin, cookie, 'content-type': 'application/json' });
mock.module('next/headers', () => ({
  headers: () => Promise.resolve(headers),
  cookies: () => {
    throw new Error('`cookies` was called outside a request scope.');
  },
}));
if (mode === 'migration') {
  const { bindMcpCredential, recordMcpGrant, verifyMcpAccessToken } = await import('@orbit/core');
  await db.insert(schema.oauthApplication).values([
    {
      id: 'legacy-public',
      clientId: 'legacy-public',
      name: 'Legacy Public',
      type: 'public',
      redirectUrls: 'http://127.0.0.1:9000/callback',
      metadata: JSON.stringify({ purpose: 'legacy fixture' }),
    },
    {
      id: 'legacy-web',
      clientId: 'legacy-web',
      name: 'Legacy Web',
      type: 'web',
      clientSecret: 'local-legacy-client-secret',
      redirectUrls: 'https://client.example.test/callback',
    },
    {
      id: 'legacy-disabled',
      clientId: 'legacy-disabled',
      name: 'Legacy Disabled',
      type: 'public',
      disabled: true,
      redirectUrls: 'https://client.example.test/disabled',
    },
    {
      id: 'legacy-collision',
      clientId: 'legacy-collision',
      name: 'Old Name',
      type: 'web',
      redirectUrls: 'https://client.example.test/collision',
    },
  ]);
  await db.insert(schema.oauthProviderClient).values({
    id: 'modern-collision',
    clientId: 'legacy-collision',
    name: 'Current Name',
    disabled: true,
    redirectUris: ['https://client.example.test/collision'],
    clientSecret: createHash('sha256').update('local-modern-client-secret').digest('base64url'),
    tokenEndpointAuthMethod: 'client_secret_post',
  });
  const grantId = await recordMcpGrant({
    clientId: 'legacy-public',
    userId: workspace.adminUser.id,
    organizationId: workspace.organizationId,
    scopes: 'orbit.read',
  });
  await db.insert(schema.oauthAccessToken).values({
    id: 'legacy-token',
    clientId: 'legacy-public',
    userId: workspace.adminUser.id,
    accessToken: 'local-legacy-access',
    refreshToken: 'local-legacy-refresh',
    mcpGrantId: grantId,
    scopes: 'orbit.read',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
  });
  const migration = await readFile(
    new URL('../../../../packages/db/drizzle/0038_auth_provider_clients.sql', import.meta.url),
    'utf8',
  );
  const statements = migration
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (statements.some((statement) => /^(?:CREATE|ALTER|DROP|TRUNCATE)\b/i.test(statement)))
    throw new Error('The client migration must use data statements only.');
  await pool.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement);
  });
  const clients = await db.select().from(schema.oauthProviderClient);
  assert.equal(
    clients.length,
    4,
    'Every known legacy client must be copied without replacing an existing modern record',
  );
  const publicClient = clients.find((client) => client.clientId === 'legacy-public');
  const webClient = clients.find((client) => client.clientId === 'legacy-web');
  assert.equal(publicClient?.tokenEndpointAuthMethod, 'none');
  assert.equal(publicClient?.applicationType, 'native');
  assert.equal(publicClient?.clientSecret, null);
  assert.deepEqual(publicClient?.metadata, { purpose: 'legacy fixture' });
  assert.equal(webClient?.tokenEndpointAuthMethod, 'client_secret_basic');
  assert.equal(webClient?.applicationType, 'web');
  assert.equal(
    webClient?.clientSecret ===
      createHash('sha256').update('local-legacy-client-secret').digest('base64url'),
    true,
  );
  assert.equal(webClient?.legacyAuthMethods, true);
  assert.equal(clients.find((client) => client.clientId === 'legacy-disabled')?.disabled, true);
  assert.equal(
    clients.find((client) => client.clientId === 'legacy-collision')?.name,
    'Current Name',
  );
  assert.equal(clients.find((client) => client.clientId === 'legacy-collision')?.disabled, true);
  assert.equal(
    clients.find((client) => client.clientId === 'legacy-collision')?.legacyAuthMethods,
    false,
  );
  assert.equal(
    clients.find((client) => client.clientId === 'legacy-collision')
      ?.legacyResourceMigrationPending,
    false,
  );
  assert.equal((await db.select().from(schema.session)).length, 1);
  const oldToken = bindMcpCredential(
    'local-legacy-access',
    grantId,
    process.env['BETTER_AUTH_SECRET'] ?? '',
  );
  assert.equal((await verifyMcpAccessToken(oldToken)).organizationId, workspace.organizationId);
  const { POST } = await import('../../src/app/api/auth/[...all]/route.ts');
  const oldRefresh = bindMcpCredential(
    'local-legacy-refresh',
    grantId,
    process.env['BETTER_AUTH_SECRET'] ?? '',
  );
  const rejected = await POST(
    new Request('http://localhost:3000/api/auth/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: 'legacy-public',
        refresh_token: oldRefresh,
      }),
    }),
  );
  assert.equal(
    rejected.status,
    400,
    'A pre-upgrade refresh credential must require reauthorization rather than silently bypassing the new provider',
  );
  assert.equal((await rejected.json()).error, 'invalid_grant');
  assert.equal((await verifyMcpAccessToken(oldToken)).organizationId, workspace.organizationId);

  await pool.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement);
  });
  assert.equal((await db.select().from(schema.oauthProviderClient)).length, 4);
  await assert.rejects(
    pool.begin(async (tx) => {
      await tx`insert into oauth_application (id, client_id, name, type, redirect_urls) values ('ambiguous', 'ambiguous', 'Ambiguous', 'unknown', 'https://client.example.test/callback')`;
      for (const statement of statements) await tx.unsafe(statement);
    }),
    /unsupported legacy OAuth client/i,
  );
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
const legacyClientId = 'local-migrated-client';
const legacyClientSecret = 'local-migrated-client-secret';
const legacyPublic =
  mode === 'legacy-public' ||
  mode === 'legacy-unlink' ||
  mode === 'legacy-no-resource' ||
  mode === 'legacy-late-public' ||
  mode === 'legacy-late-disabled' ||
  mode === 'legacy-late-invalid';
const legacyClientType = legacyPublic ? 'public' : 'web';
if (mode.startsWith('legacy-')) {
  await db.insert(schema.oauthApplication).values({
    id: 'local-legacy-client-row',
    clientId: legacyClientId,
    name: 'Legacy Client',
    type: mode === 'legacy-late-invalid' ? 'unknown' : legacyClientType,
    disabled: mode === 'legacy-late-disabled',
    clientSecret: legacyPublic ? null : legacyClientSecret,
    redirectUrls: 'http://127.0.0.1:9000/callback',
  });
  if (!mode.startsWith('legacy-late-')) {
    const migration = await readFile(
      new URL('../../../../packages/db/drizzle/0038_auth_provider_clients.sql', import.meta.url),
      'utf8',
    );
    await pool.begin(async (tx) => {
      for (const statement of migration
        .split('--> statement-breakpoint')
        .map((value) => value.trim())
        .filter(Boolean))
        await tx.unsafe(statement);
    });
  }
}
const routes = await import('../../src/app/api/auth/[...all]/route.ts');
const decision = await import('../../src/app/(auth)/oauth/authorize/decision/route.ts');
const { default: consentPage } = await import('../../src/app/(auth)/oauth/authorize/page.tsx');
const { verifyMcpAccessToken, revokeMcpGrant } = await import('@orbit/core');
if (mode === 'session-read') {
  const current = await routes.GET(new Request(`${origin}/api/auth/get-session`, { headers }));
  assert.equal(current.status, 200);
  assert.equal(
    current.headers.has('set-auth-jwt'),
    false,
    'Ordinary session reads must not start issuing an unused JWT',
  );
  assert.equal((await db.select().from(schema.authJwks)).length, 0);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
async function registeredClient() {
  if (mode.startsWith('legacy-')) return { client_id: legacyClientId };
  const registration = await routes.POST(
    new Request(`${origin}/api/auth/mcp/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_name: 'Local MCP Client',
        redirect_uris: ['http://127.0.0.1:9000/callback'],
        token_endpoint_auth_method: mode.startsWith('modern-basic')
          ? 'client_secret_basic'
          : 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid profile email offline_access orbit.read',
      }),
    }),
  );
  assert.equal(
    registration.status,
    201,
    `MCP registration must reach the patched provider: ${registration.status === 201 ? '' : await registration.clone().text()}`,
  );
  return z
    .object({ client_id: z.string(), client_secret: z.string().optional() })
    .parse(await registration.json());
}
const registered = await registeredClient();
const clientSecret = 'client_secret' in registered ? registered.client_secret : legacyClientSecret;
const verifier = 'local-upgrade-pkce-verifier-with-more-than-43-characters';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const query = new URLSearchParams({
  response_type: 'code',
  client_id: registered.client_id,
  redirect_uri: 'http://127.0.0.1:9000/callback',
  scope: 'openid profile email offline_access orbit.read',
  prompt: 'consent',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource: mode === 'foreign-resource' ? 'https://untrusted.example.test/mcp' : `${origin}/mcp`,
  state: 'local-flow-state',
});
if (mode === 'legacy-no-resource') query.delete('resource');
const authorization = await routes.GET(
  new Request(`${origin}/api/auth/mcp/authorize?${query}`, { headers }),
);
assert.equal(authorization.status, 302, 'The existing MCP authorization URL must remain usable');
const consentUrl = new URL(authorization.headers.get('location') ?? '', origin);
if (mode === 'foreign-resource') {
  assert.equal(consentUrl.searchParams.get('error'), 'invalid_target');
  assert.equal((await db.select().from(schema.mcpGrant)).length, 0);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'legacy-late-disabled' || mode === 'legacy-late-invalid') {
  assert.notEqual(consentUrl.pathname, '/oauth/authorize');
  assert.equal((await db.select().from(schema.mcpGrant)).length, 0);
  const clients = await db.select().from(schema.oauthProviderClient);
  assert.equal(clients.length, mode === 'legacy-late-disabled' ? 1 : 0);
  if (mode === 'legacy-late-disabled') assert.equal(clients[0]?.disabled, true);
  assert.equal((await db.select().from(schema.oauthProviderClientResource)).length, 0);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
assert.equal(
  consentUrl.pathname,
  '/oauth/authorize',
  `Authorization failed: ${consentUrl.searchParams.get('error') ?? ''}`,
);
const parameters: Record<string, string | string[]> = {};
for (const key of new Set(consentUrl.searchParams.keys())) {
  const values = consentUrl.searchParams.getAll(key);
  parameters[key] = values.length === 1 ? (values[0] ?? '') : values;
}
const rendered = await consentPage({ searchParams: Promise.resolve(parameters) });
function consentCode(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = consentCode(child);
      if (found !== null) return found;
    }
  }
  if (!isValidElement<{ children?: unknown; consentCode?: unknown }>(node)) return null;
  if (typeof node.props.consentCode === 'string') return node.props.consentCode;
  return consentCode(node.props.children);
}
const code = consentCode(rendered);
assert.ok(code, 'Signed provider consent must render an Orbit workspace choice');
const approved = await decision.POST(
  new Request(`${origin}/oauth/authorize/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      decision: 'allow',
      consentCode: code,
      organizationId: workspace.organizationId,
    }),
  }),
);
assert.equal(approved.status, 200, 'Workspace consent must complete through the patched provider');
const result = z.object({ redirectUri: z.string() }).parse(await approved.json());
const approvedUrl = new URL(result.redirectUri);
assert.equal(approvedUrl.searchParams.get('state'), 'local-flow-state');
const authorizationCode = approvedUrl.searchParams.get('code');
assert.ok(authorizationCode);
function token(body: Record<string, string>): Promise<Response> {
  const parameters =
    mode === 'legacy-no-resource'
      ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'resource'))
      : body;
  const tokenHeaders = new Headers(headers);
  if (mode.endsWith('-basic')) {
    tokenHeaders.set(
      'authorization',
      `Basic ${Buffer.from(`${registered.client_id}:${clientSecret}`).toString('base64')}`,
    );
  }
  return routes.POST(
    new Request(`${origin}/api/auth/mcp/token`, {
      method: 'POST',
      headers: tokenHeaders,
      body: JSON.stringify({
        ...parameters,
        client_id: registered.client_id,
        ...(mode.includes('-post')
          ? { client_secret: mode === 'legacy-post-wrong' ? 'wrong-local-secret' : clientSecret }
          : {}),
      }),
    }),
  );
}
const issued = await token({
  grant_type: 'authorization_code',
  code: authorizationCode,
  redirect_uri: 'http://127.0.0.1:9000/callback',
  code_verifier: verifier,
  resource: `${origin}/mcp`,
});
if (mode === 'modern-basic-post' || mode === 'legacy-post-wrong') {
  assert.ok([400, 401].includes(issued.status));
  assert.equal((await issued.json()).error, 'invalid_client');
  assert.equal((await db.select().from(schema.oauthAccessToken)).length, 0);
  assert.equal((await db.select().from(schema.oauthProviderRefreshToken)).length, 0);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
assert.equal(
  issued.status,
  200,
  `The consented PKCE code must exchange for bound credentials: ${issued.status === 200 ? '' : await issued.clone().text()}`,
);
const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string() });
const credentials = tokenSchema.parse(await issued.json());
const access = await verifyMcpAccessToken(credentials.access_token);
assert.equal(access.organizationId, workspace.organizationId);
assert.equal(access.userId, workspace.adminUser.id);
if (mode === 'legacy-unlink') {
  await db
    .delete(schema.oauthProviderClientResource)
    .where(eq(schema.oauthProviderClientResource.clientId, registered.client_id));
  const migration = await readFile(
    new URL('../../../../packages/db/drizzle/0038_auth_provider_clients.sql', import.meta.url),
    'utf8',
  );
  await pool.begin(async (tx) => {
    for (const statement of migration
      .split('--> statement-breakpoint')
      .map((value) => value.trim())
      .filter(Boolean))
      await tx.unsafe(statement);
  });
  const blocked = await routes.GET(
    new Request(`${origin}/api/auth/mcp/authorize?${query}`, { headers }),
  );
  const blockedUrl = new URL(blocked.headers.get('location') ?? '', origin);
  assert.equal(
    blockedUrl.searchParams.get('error'),
    'invalid_target',
    'An operator resource unlink must remain effective after migration and authorization retries',
  );
  const [client] = await db
    .select()
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, registered.client_id));
  assert.equal(client?.legacyResourceMigrationPending, false);
  assert.equal(
    (
      await db
        .select()
        .from(schema.oauthProviderClientResource)
        .where(eq(schema.oauthProviderClientResource.clientId, registered.client_id))
    ).length,
    0,
  );
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'provider-revoke') {
  const revocationHeaders = new Headers(headers);
  revocationHeaders.set('content-type', 'application/x-www-form-urlencoded');
  const revoked = await routes.POST(
    new Request(`${origin}/api/auth/oauth2/revoke`, {
      method: 'POST',
      headers: revocationHeaders,
      body: new URLSearchParams({
        client_id: registered.client_id,
        token: credentials.refresh_token,
        token_type_hint: 'refresh_token',
      }),
    }),
  );
  assert.equal(
    revoked.status,
    200,
    `Revocation response: ${revoked.status === 200 ? '' : await revoked.clone().text()}`,
  );
  await assert.rejects(
    verifyMcpAccessToken(credentials.access_token),
    'Protocol revocation must invalidate Orbit access',
  );
  const denied = await token({
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
    resource: `${origin}/mcp`,
  });
  assert.equal(denied.status, 400);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'replay') {
  const replay = await token({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: 'http://127.0.0.1:9000/callback',
    code_verifier: verifier,
    resource: `${origin}/mcp`,
  });
  assert.equal(replay.status, 400);
  await assert.rejects(
    verifyMcpAccessToken(credentials.access_token),
    'Authorization-code replay must revoke its issued credentials',
  );
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'session') {
  const signedOut = await routes.POST(
    new Request(`${origin}/api/auth/sign-out`, { method: 'POST', headers, body: '{}' }),
  );
  assert.equal(signedOut.status, 200);
  await assert.rejects(
    verifyMcpAccessToken(credentials.access_token),
    'Session-bound MCP access must stop after sign-out',
  );
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
const refreshed = await token({
  grant_type: 'refresh_token',
  refresh_token: credentials.refresh_token,
  resource: `${origin}/mcp`,
});
assert.equal(refreshed.status, 200);
const rotated = tokenSchema.parse(await refreshed.json());
assert.equal((await verifyMcpAccessToken(rotated.access_token)).grantId, access.grantId);
await revokeMcpGrant(access.grantId, workspace.adminUser.id);
await assert.rejects(verifyMcpAccessToken(rotated.access_token));
const rejected = await token({
  grant_type: 'refresh_token',
  refresh_token: rotated.refresh_token,
  resource: `${origin}/mcp`,
});
assert.equal(rejected.status, 400);
const [remaining] = await db
  .select()
  .from(schema.mcpGrant)
  .where(eq(schema.mcpGrant.id, access.grantId));
assert.ok(remaining?.revokedAt);
console.log(
  JSON.stringify({ completed: true, mode, boundToWorkspace: true, rotation: true, revoked: true }),
);
await pool.end();
