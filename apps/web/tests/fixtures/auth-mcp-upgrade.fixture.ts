import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { encodeBasicCredentials } from '@better-auth/core/oauth2';
import { createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { db, eq, pool, schema, sql, type Transaction } from '@orbit/db';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
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
    'registration',
    'legacy-mixed',
    'legacy-late-mixed',
    'legacy-mixed-custom',
    'legacy-late-mixed-custom',
    'legacy-deleted-client',
    'deleted-client',
    'disabled-client',
    'legacy-reserved',
    'legacy-late-reserved',
    'legacy-userinfo',
    'legacy-late-userinfo',
    'legacy-foreign-http',
    'legacy-late-foreign-http',
    'legacy-fragment',
    'legacy-late-fragment',
    'claims-login',
    'no-prompt',
    'access-revoke',
    'replay-access-only',
    'replay-before-persist',
    'concurrent-access-only',
    'legacy-loopback-subnet',
    'legacy-late-loopback-subnet',
    'legacy-loopback-policy',
    'legacy-space-basic',
    'legacy-plus-basic',
    'private-key-revoke',
  ])
  .parse(process.argv[2] ?? 'grant');
const accessOnlyMode = [
  'replay-access-only',
  'replay-before-persist',
  'concurrent-access-only',
].includes(mode);
function callbackForMode(): string {
  if (mode.includes('loopback')) return 'http://127.0.0.2:9000/callback';
  if (mode.includes('reserved')) return 'javascript:alert(1)//';
  if (mode.includes('userinfo')) return 'http://user@127.0.0.1:9000/callback';
  if (mode.includes('foreign-http')) return 'http://client.example.test/callback';
  if (mode.includes('fragment')) return 'http://127.0.0.1:9000/callback#fragment';
  return mode.includes('mixed-custom')
    ? 'http://localhost:8787/callback'
    : 'http://127.0.0.1:9000/callback';
}
const callbackUri = callbackForMode();
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
      redirectUrls: callbackUri,
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
  const originalClients = await db
    .select()
    .from(schema.oauthApplication)
    .orderBy(schema.oauthApplication.clientId);
  assert.ok(originalClients.every((client) => client.providerMigratedAt === null));
  const originalClientFields = originalClients.map(({ providerMigratedAt, ...client }) => {
    assert.equal(providerMigratedAt, null);
    return client;
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
  const retainedClients = await db
    .select()
    .from(schema.oauthApplication)
    .orderBy(schema.oauthApplication.clientId);
  assert.deepEqual(
    retainedClients.map(({ providerMigratedAt, ...client }) => {
      assert.ok(providerMigratedAt instanceof Date);
      return client;
    }),
    originalClientFields,
    'The client copy must preserve every original legacy client field',
  );
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
  assert.deepEqual(
    await db.select().from(schema.oauthApplication).orderBy(schema.oauthApplication.clientId),
    retainedClients,
    'An idempotent client copy must preserve the durable migration marker',
  );
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
function migratedClientId(): string {
  if (mode === 'legacy-space-basic') return 'local client';
  if (mode === 'legacy-plus-basic') return 'local+client';
  return 'local-migrated-client';
}
const legacyClientId = migratedClientId();
const legacyClientSecret = 'local-migrated-client-secret';
const legacyPublic =
  mode.includes('mixed') ||
  mode.includes('loopback') ||
  mode.includes('reserved') ||
  mode === 'legacy-deleted-client' ||
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
    redirectUrls: mode.includes('mixed')
      ? [
          callbackUri,
          'https://client.example.test/callback',
          ...(mode.includes('mixed-custom')
            ? ['cursor://anysphere.cursor-mcp/oauth/callback']
            : []),
        ].join(',')
      : callbackUri,
  });
  if (mode.includes('loopback'))
    await db
      .update(schema.oauthApplication)
      .set({
        createdAt: sql`timestamp with time zone '2026-11-16 00:00:00.123456+00'`,
        updatedAt: sql`timestamp with time zone '2026-11-16 00:00:00.654321+00'`,
      })
      .where(eq(schema.oauthApplication.clientId, legacyClientId));
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
if (mode === 'legacy-loopback-policy') {
  const { auth } = await import('../../src/lib/auth/server.ts');
  await auth.$context;
  const { ensureLegacyMcpClient } = await import('../../src/lib/auth/mcp-legacy-client.ts');
  const rollback = new Error('Local policy control rollback');
  const mutations: readonly ((tx: Transaction) => Promise<unknown>)[] = [
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ name: 'Operator name' })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ metadata: { operator: 'preserve' } })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ scopes: ['orbit.read'] })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ tokenEndpointAuthMethod: 'client_secret_post' })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ jwksUri: 'https://operator.example.test/jwks' })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ skipConsent: true })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ legacyResourceMigrationPending: false })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ disabled: true })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ updatedAt: sql`${schema.oauthProviderClient.updatedAt} + interval '1 microsecond'` })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .update(schema.oauthProviderClient)
        .set({ createdAt: sql`${schema.oauthProviderClient.createdAt} + interval '1 microsecond'` })
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    (tx) =>
      tx
        .delete(schema.oauthProviderClient)
        .where(eq(schema.oauthProviderClient.clientId, legacyClientId)),
    async (tx) => {
      await tx.insert(schema.oauthProviderResource).values({
        id: randomUUID(),
        identifier: 'https://operator.example.test/mcp',
        name: 'Operator resource policy',
      });
      await tx.insert(schema.oauthProviderClientResource).values({
        id: randomUUID(),
        clientId: legacyClientId,
        resourceId: 'https://operator.example.test/mcp',
      });
    },
  ];
  for (const mutate of mutations) {
    try {
      await db.transaction(async (tx) => {
        await mutate(tx);
        const [before] = await tx
          .select()
          .from(schema.oauthProviderClient)
          .where(eq(schema.oauthProviderClient.clientId, legacyClientId));
        await ensureLegacyMcpClient(tx, legacyClientId);
        const [after] = await tx
          .select()
          .from(schema.oauthProviderClient)
          .where(eq(schema.oauthProviderClient.clientId, legacyClientId));
        assert.deepEqual(after, before, 'A modern operator policy edit must remain untouched');
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  await db.transaction((tx) => ensureLegacyMcpClient(tx, legacyClientId));
  const [repaired] = await db
    .select()
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, legacyClientId));
  assert.ok(repaired);
  assert.equal(repaired.applicationType, 'native');
  const [precision] = await db.execute<{ createdPreserved: boolean; policyUpdated: boolean }>(sql`
    select copied.created_at is not distinct from legacy.created_at as "createdPreserved",
      copied.updated_at is distinct from legacy.updated_at as "policyUpdated"
    from oauth_provider_client copied join oauth_application legacy on copied.id=legacy.id
    where copied.client_id=${legacyClientId}
  `);
  assert.equal(precision?.createdPreserved, true);
  assert.equal(precision?.policyUpdated, true);
  await db
    .update(schema.oauthProviderClient)
    .set({ applicationType: 'web' })
    .where(eq(schema.oauthProviderClient.clientId, legacyClientId));
  await db.transaction((tx) => ensureLegacyMcpClient(tx, legacyClientId));
  const [operatorReset] = await db
    .select()
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, legacyClientId));
  assert.equal(operatorReset?.applicationType, 'web');
  assert.equal(operatorReset?.updatedAt?.getTime(), repaired.updatedAt?.getTime());
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'registration') {
  const cases = [
    {
      redirects: ['cursor://anysphere.cursor-mcp/oauth/callback'],
      expected: 201,
      application: 'native',
    },
    {
      redirects: [
        'cursor://anysphere.cursor-mcp/oauth/callback',
        'https://client.example.test/callback',
        'http://localhost:8787/callback',
      ],
      expected: 201,
      application: 'native',
    },
    { redirects: [callbackUri], expected: 201, application: 'native' },
    { redirects: ['http://[::1]:9000/callback'], expected: 201, application: 'native' },
    { redirects: ['https://client.example.test/callback'], expected: 201, application: 'web' },
    { redirects: ['cursor://anysphere.cursor-mcp/oauth/callback'], expected: 400, explicit: 'web' },
    { redirects: ['javascript:alert(1)'], expected: 400 },
    { redirects: ['https://user:password@client.example.test/callback'], expected: 400 },
    {
      redirects: [
        'cursor://anysphere.cursor-mcp/oauth/callback',
        'http://client.example.test/callback',
      ],
      expected: 400,
    },
  ];
  for (const test of cases) {
    const response = await routes.POST(
      new Request(`${origin}/api/auth/mcp/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          client_name: 'Local redirect policy control',
          redirect_uris: test.redirects,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          ...(test.explicit === undefined ? {} : { application_type: test.explicit }),
        }),
      }),
    );
    assert.equal(
      response.status,
      test.expected,
      'The registered redirect policy must retain native compatibility without weakening explicit web or URI validation',
    );
    const body = await response.json();
    if (test.expected === 201) assert.equal(body.application_type, test.application);
    else assert.equal(body.error, 'invalid_redirect_uri');
  }
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
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
        redirect_uris: [callbackUri],
        token_endpoint_auth_method:
          mode.startsWith('modern-basic') || mode === 'access-revoke'
            ? 'client_secret_basic'
            : 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: accessOnlyMode
          ? 'openid profile email orbit.read'
          : 'openid profile email offline_access orbit.read',
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
  redirect_uri: callbackUri,
  scope: accessOnlyMode
    ? 'openid profile email orbit.read'
    : 'openid profile email offline_access orbit.read',
  prompt: 'consent',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource: mode === 'foreign-resource' ? 'https://untrusted.example.test/mcp' : `${origin}/mcp`,
  state: 'local-flow-state',
});
if (mode === 'legacy-no-resource') query.delete('resource');
if (mode === 'no-prompt') query.delete('prompt');
if (mode === 'claims-login') {
  query.set('claims', JSON.stringify({ userinfo: { email: null } }));
  headers.delete('cookie');
}
let authorization = await routes.GET(
  new Request(`${origin}/api/auth/mcp/authorize?${query}`, { headers }),
);
if (mode === 'claims-login') {
  assert.equal(authorization.status, 302);
  const loginUrl = new URL(authorization.headers.get('location') ?? '', origin);
  assert.equal(loginUrl.pathname, '/login');
  const { mcpContinueUrl } = await import('../../src/app/(auth)/login/continue-url.ts');
  const { verifyOAuthQueryParams } = await import('@better-auth/oauth-provider');
  const loginParameters: Record<string, string | string[]> = {};
  for (const key of new Set(loginUrl.searchParams.keys())) {
    const values = loginUrl.searchParams.getAll(key);
    loginParameters[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  const resumed = mcpContinueUrl(loginParameters);
  assert.ok(resumed);
  const resumedUrl = new URL(resumed, origin);
  assert.equal(resumedUrl.searchParams.get('claims'), query.get('claims'));
  assert.equal(
    await verifyOAuthQueryParams(
      resumedUrl.searchParams.toString(),
      process.env['BETTER_AUTH_SECRET'] ?? '',
    ),
    true,
  );
  headers.set('cookie', cookie);
  authorization = await routes.GET(new Request(resumedUrl, { headers }));
}
assert.equal(authorization.status, 302, 'The existing MCP authorization URL must remain usable');
const consentUrl = new URL(authorization.headers.get('location') ?? '', origin);
if (['reserved', 'userinfo', 'foreign-http', 'fragment'].some((name) => mode.includes(name))) {
  assert.equal(consentUrl.origin, origin);
  assert.equal(consentUrl.pathname, '/api/auth/error');
  const invalidSignature = new URLSearchParams(query);
  invalidSignature.set('sig', 'invalid-local-signature');
  invalidSignature.set('exp', String(Math.floor(Date.now() / 1000) + 300));
  const rejectedSignature = await routes.GET(
    new Request(`${origin}/api/auth/mcp/authorize?${invalidSignature}`, { headers }),
  );
  assert.equal(rejectedSignature.status, 302);
  const signatureError = new URL(rejectedSignature.headers.get('location') ?? '', origin);
  assert.equal(signatureError.origin, origin);
  assert.equal(signatureError.pathname, '/api/auth/error');
  assert.equal((await db.select().from(schema.mcpGrant)).length, 0);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
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
  if (mode.endsWith('-basic') || mode === 'access-revoke') {
    tokenHeaders.set(
      'authorization',
      encodeBasicCredentials(registered.client_id, clientSecret ?? ''),
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
const authorizationExchange = {
  grant_type: 'authorization_code',
  code: authorizationCode,
  redirect_uri: callbackUri,
  code_verifier: verifier,
  resource: `${origin}/mcp`,
};
if (mode === 'concurrent-access-only') {
  const responses = await Promise.all([token(authorizationExchange), token(authorizationExchange)]);
  assert.ok(responses.some((response) => response.status === 400));
  for (const response of responses) {
    assert.ok(response.status === 200 || response.status === 400);
    if (response.status !== 200) continue;
    const result = z.object({ access_token: z.string() }).parse(await response.json());
    await assert.rejects(
      verifyMcpAccessToken(result.access_token),
      'Concurrent code replay must not leave a usable access-only credential',
    );
  }
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
let replayBeforePersistenceStatus: number | undefined;
if (mode === 'replay-before-persist') {
  const { auth } = await import('../../src/lib/auth/server.ts');
  const issue = auth.api.oauth2Token;
  let replayed = false;
  Reflect.set(auth.api, 'oauth2Token', async (input: Parameters<typeof issue>[0]) => {
    const response = await issue(input);
    if (response instanceof Response && response.ok && !replayed) {
      replayed = true;
      const replay = await issue(input);
      if (replay instanceof Response) replayBeforePersistenceStatus = replay.status;
    }
    return response;
  });
}
const issued = await token(authorizationExchange);
if (mode === 'replay-before-persist') {
  assert.equal(replayBeforePersistenceStatus, 400);
  assert.equal(issued.status, 400);
  assert.equal((await db.select().from(schema.oauthAccessToken)).length, 0);
  assert.equal((await db.select().from(schema.oauthProviderAccessToken)).length, 0);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
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
const tokenResponse: unknown = await issued.json();
if (mode === 'replay-access-only') {
  const accessOnly = z
    .object({ access_token: z.string(), refresh_token: z.undefined().optional() })
    .parse(tokenResponse);
  await verifyMcpAccessToken(accessOnly.access_token);
  const replayed = await token({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: callbackUri,
    code_verifier: verifier,
    resource: `${origin}/mcp`,
  });
  assert.equal(replayed.status, 400);
  await assert.rejects(
    verifyMcpAccessToken(accessOnly.access_token),
    'Authorization-code replay must also invalidate access-only credentials',
  );
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string() });
const credentials = tokenSchema.parse(tokenResponse);
const access = await verifyMcpAccessToken(credentials.access_token);
assert.equal(access.organizationId, workspace.organizationId);
assert.equal(access.userId, workspace.adminUser.id);
if (mode === 'no-prompt') {
  const repeated = await routes.GET(
    new Request(`${origin}/api/auth/mcp/authorize?${query}`, { headers }),
  );
  assert.equal(repeated.status, 302);
  const repeatedUrl = new URL(repeated.headers.get('location') ?? '', origin);
  assert.equal(repeatedUrl.pathname, '/oauth/authorize');
  assert.equal((await db.select().from(schema.oauthAccessToken)).length, 1);
  for (const prompt of ['none', 'login consent', 'consent unknown']) {
    const unsupported = new URLSearchParams(query);
    unsupported.set('prompt', prompt);
    const rejected = await routes.GET(
      new Request(`${origin}/api/auth/mcp/authorize?${unsupported}`, { headers }),
    );
    assert.equal(rejected.status, 400);
  }
}
if (mode === 'access-revoke' || mode === 'legacy-space-basic' || mode === 'legacy-plus-basic') {
  function revokeAccess(
    clientId: string,
    secret: string | undefined,
    spaces = false,
    credential = credentials.access_token,
  ) {
    const revocationHeaders = new Headers(headers);
    revocationHeaders.set('content-type', 'application/x-www-form-urlencoded');
    if (secret !== undefined)
      revocationHeaders.set(
        'authorization',
        spaces
          ? encodeBasicCredentials(clientId, secret).replace(/^Basic /, 'Basic  ')
          : encodeBasicCredentials(clientId, secret),
      );
    return routes.POST(
      new Request(`${origin}/api/auth/oauth2/revoke`, {
        method: 'POST',
        headers: revocationHeaders,
        body: new URLSearchParams({
          client_id: clientId,
          token: credential,
          token_type_hint: 'access_token',
        }),
      }),
    );
  }
  const wrongSecret = await revokeAccess(registered.client_id, 'wrong-local-secret');
  assert.equal(wrongSecret.status, 401);
  await verifyMcpAccessToken(credentials.access_token);
  const { bindMcpCredential } = await import('@orbit/core');
  const unknownBound = bindMcpCredential(
    'local-unrecognized-opaque-credential',
    access.grantId,
    process.env['BETTER_AUTH_SECRET'] ?? '',
  );
  for (const unknown of ['local-random-opaque-credential', unknownBound]) {
    const unknownResponse = await revokeAccess(registered.client_id, clientSecret, false, unknown);
    const unknownResult = z
      .object({ error: z.string() })
      .parse(await unknownResponse.clone().json());
    assert.equal(unknownResponse.status, 400);
    assert.equal(unknownResult.error, 'invalid_request');
    await verifyMcpAccessToken(credentials.access_token);
  }
  const otherRegistration = await routes.POST(
    new Request(`${origin}/api/auth/mcp/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_name: 'Another local client',
        redirect_uris: [callbackUri],
        token_endpoint_auth_method: 'none',
      }),
    }),
  );
  assert.equal(otherRegistration.status, 201);
  const other = z.object({ client_id: z.string() }).parse(await otherRegistration.json());
  assert.equal((await revokeAccess(other.client_id, undefined)).status, 200);
  await verifyMcpAccessToken(credentials.access_token);
  assert.equal((await revokeAccess(registered.client_id, clientSecret, true)).status, 200);
  await assert.rejects(verifyMcpAccessToken(credentials.access_token));
  assert.equal((await revokeAccess(registered.client_id, clientSecret)).status, 200);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'private-key-revoke') {
  const pair = await generateKeyPair('ES256');
  const jwk = await exportJWK(pair.publicKey);
  await db
    .update(schema.oauthProviderClient)
    .set({
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwks: JSON.stringify({ keys: [{ ...jwk, kid: 'local-assertion-key', alg: 'ES256' }] }),
    })
    .where(eq(schema.oauthProviderClient.clientId, registered.client_id));
  function assertion(key = pair.privateKey) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'local-assertion-key' })
      .setIssuer(registered.client_id)
      .setSubject(registered.client_id)
      .setAudience(`${origin}/api/auth/oauth2/revoke`)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }
  function revokeWithAssertion(value: string, emptyHint = false) {
    const revocationHeaders = new Headers(headers);
    revocationHeaders.set('content-type', 'application/x-www-form-urlencoded');
    return routes.POST(
      new Request(`${origin}/api/auth/oauth2/revoke`, {
        method: 'POST',
        headers: revocationHeaders,
        body: new URLSearchParams({
          token: credentials.access_token,
          token_type_hint: 'access_token',
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: value,
          ...(emptyHint ? { client_id: '' } : {}),
        }),
      }),
    );
  }
  const wrong = await generateKeyPair('ES256');
  assert.equal((await revokeWithAssertion(await assertion(wrong.privateKey))).status, 401);
  await verifyMcpAccessToken(credentials.access_token);
  const valid = await assertion();
  assert.equal((await revokeWithAssertion(valid, true)).status, 200);
  await assert.rejects(verifyMcpAccessToken(credentials.access_token));
  const replayedAssertion = await revokeWithAssertion(valid);
  assert.equal(replayedAssertion.status, 400);
  assert.equal((await replayedAssertion.json()).error, 'invalid_client');
  assert.equal((await revokeWithAssertion(await assertion())).status, 200);
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'deleted-client' || mode === 'legacy-deleted-client') {
  const [copied] = await db
    .select()
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, registered.client_id));
  assert.ok(copied?.providerMigratedAt instanceof Date);
  await db
    .delete(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, registered.client_id));
  await assert.rejects(verifyMcpAccessToken(credentials.access_token));
  const migration = await readFile(
    new URL('../../../../packages/db/drizzle/0038_auth_provider_clients.sql', import.meta.url),
    'utf8',
  );
  await pool.begin(async (tx) => {
    for (const statement of migration.split('--> statement-breakpoint').filter(Boolean))
      await tx.unsafe(statement);
  });
  const retried = await routes.GET(
    new Request(`${origin}/api/auth/mcp/authorize?${query}`, { headers }),
  );
  assert.notEqual(
    new URL(retried.headers.get('location') ?? '', origin).pathname,
    '/oauth/authorize',
    'A deleted provider client must remain inactive through the legacy bridge',
  );
  assert.equal((await db.select().from(schema.oauthProviderClient)).length, 0);
  const [retained] = await db
    .select()
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, registered.client_id));
  assert.equal(retained?.providerMigratedAt?.getTime(), copied.providerMigratedAt.getTime());
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
if (mode === 'disabled-client') {
  await db
    .update(schema.oauthProviderClient)
    .set({ disabled: true })
    .where(eq(schema.oauthProviderClient.clientId, registered.client_id));
  await assert.rejects(
    verifyMcpAccessToken(credentials.access_token),
    'A disabled provider client must not retain Orbit access',
  );
  console.log(JSON.stringify({ completed: true, mode }));
  await pool.end();
  process.exit(0);
}
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
    redirect_uri: callbackUri,
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
