import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { mcpTokenResponseSchema } from '@orbit/shared/validators';
import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { connectOverHttp } from '../../../packages/mcp-server/src/test-helpers.ts';
import { BASE } from './base-url.ts';

const DEMO_EMAIL = 'alex@orbit.example';
const REDIRECT_URI = 'http://127.0.0.1:23987/callback';
const MCP_URL = `${BASE}/mcp`;
const protectedMetadataSchema = z.object({
  resource: z.string().url(),
  authorization_servers: z.array(z.string().url()).min(1),
  scopes_supported: z.array(z.string()),
});
const authorizationMetadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  registration_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  scopes_supported: z.array(z.string()),
});
const registeredClientSchema = z.object({ client_id: z.string().min(1) }).passthrough();
const meSchema = z.object({
  actor: z.object({ type: z.literal('agent'), id: z.string(), name: z.string() }),
  agent: z.object({ id: z.string(), name: z.string() }),
  principal: z.object({ type: z.literal('user'), id: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  teams: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })).min(1),
});
const createdIssueSchema = z.object({
  issue: z.object({ id: z.string(), identifier: z.string(), title: z.string() }),
});
const updatedIssueSchema = z.object({
  changed: z.array(z.string()),
  issue: z.object({ assigneeAgentId: z.string().nullable() }),
});
const agentQueueSchema = z.object({
  issues: z.array(z.object({ id: z.string(), identifier: z.string() })),
});

interface OAuthMetadata {
  readonly protectedResource: z.infer<typeof protectedMetadataSchema>;
  readonly authorizationServer: z.infer<typeof authorizationMetadataSchema>;
}

interface OAuthClientToken {
  readonly accessToken: string;
  readonly agentName: string;
  readonly clientId: string;
}

function tokenFilePath(): string {
  const path = process.env['ORBIT_MCP_VALIDATION_TOKEN_FILE'];
  if (path === undefined || path.trim().length === 0) {
    throw new Error('ORBIT_MCP_VALIDATION_TOKEN_FILE is required for the two-phase gate drill.');
  }
  return path;
}

async function jsonResponse(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

async function oauthMetadata(): Promise<OAuthMetadata> {
  const protectedResponse = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`);
  expect(protectedResponse.status).toBe(200);
  const protectedResource = protectedMetadataSchema.parse(await jsonResponse(protectedResponse));
  const authorizationResponse = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  expect(authorizationResponse.status).toBe(200);
  const authorizationServer = authorizationMetadataSchema.parse(
    await jsonResponse(authorizationResponse),
  );
  const openIdResponse = await fetch(`${BASE}/.well-known/openid-configuration`);
  expect(openIdResponse.status).toBe(200);
  const openId = authorizationMetadataSchema.parse(await jsonResponse(openIdResponse));
  expect(openId.issuer).toBe(authorizationServer.issuer);
  const localOrigin = new URL(BASE).origin;
  expect(protectedResource.resource).toBe(MCP_URL);
  expect(protectedResource.authorization_servers).toEqual([localOrigin]);
  expect(new URL(authorizationServer.issuer).origin).toBe(localOrigin);
  for (const endpoint of [
    authorizationServer.authorization_endpoint,
    authorizationServer.token_endpoint,
    authorizationServer.registration_endpoint,
    authorizationServer.jwks_uri,
  ]) {
    expect(new URL(endpoint).origin).toBe(localOrigin);
  }
  expect(authorizationServer.authorization_endpoint).toBe(`${BASE}/api/oauth/start`);
  expect(authorizationServer.token_endpoint).toBe(`${BASE}/api/auth/mcp/token`);
  expect(authorizationServer.registration_endpoint).toBe(`${BASE}/api/auth/mcp/register`);
  expect(authorizationServer.scopes_supported).toContain('orbit.read');
  expect(authorizationServer.scopes_supported).toContain('orbit.write');
  expect(new URL(REDIRECT_URI).hostname).toBe('127.0.0.1');
  return { protectedResource, authorizationServer };
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${DEMO_EMAIL}`).click();
  await page.waitForURL(`${BASE}/my-issues`, { waitUntil: 'domcontentloaded' });
}

async function authorizeAgent(
  page: Page,
  metadata: OAuthMetadata,
  agentName: string,
  options: { readonly clientId?: string; readonly selectAgentName?: string } = {},
): Promise<OAuthClientToken> {
  let clientId = options.clientId;
  if (clientId === undefined) {
    const registrationResponse = await fetch(metadata.authorizationServer.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: `Issue 215 ${agentName}`,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid profile email offline_access orbit.read orbit.write',
      }),
    });
    if (!registrationResponse.ok) {
      throw new Error(`Dynamic client registration answered ${registrationResponse.status}.`);
    }
    clientId = registeredClientSchema.parse(await jsonResponse(registrationResponse)).client_id;
  }
  const codeVerifier = `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomUUID();
  const authorization = new URL(metadata.authorizationServer.authorization_endpoint);
  authorization.searchParams.set('client_id', clientId);
  authorization.searchParams.set('redirect_uri', REDIRECT_URI);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set(
    'scope',
    'openid profile email offline_access orbit.read orbit.write',
  );
  authorization.searchParams.set('state', state);
  authorization.searchParams.set('code_challenge', codeChallenge);
  authorization.searchParams.set('code_challenge_method', 'S256');
  authorization.searchParams.set('resource', metadata.protectedResource.resource);
  authorization.searchParams.set('prompt', 'consent');
  await page.goto(authorization.toString());
  const workspaceId = await page.getByLabel('Workspace').inputValue();
  expect(workspaceId.length).toBeGreaterThan(0);
  if (options.selectAgentName === undefined) {
    await page.getByLabel('Agent identity').selectOption({ label: 'Create a new agent' });
    await page.getByLabel('Agent name').fill(agentName);
  } else {
    await page.getByLabel('Agent identity').selectOption({ label: options.selectAgentName });
  }
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForURL(
    (url) =>
      url.origin === new URL(REDIRECT_URI).origin &&
      url.pathname === new URL(REDIRECT_URI).pathname &&
      url.searchParams.has('code'),
  );
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(state);
  const code = callback.searchParams.get('code');
  if (code === null) throw new Error('The local Consent redirect returned no authorization code.');
  const tokenResponse = await page.request.post(metadata.authorizationServer.token_endpoint, {
    form: {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      resource: metadata.protectedResource.resource,
    },
  });
  if (!tokenResponse.ok()) {
    throw new Error(`The local OAuth token endpoint answered ${tokenResponse.status()}.`);
  }
  const token = mcpTokenResponseSchema.parse(await tokenResponse.json());
  return { accessToken: token.access_token, agentName, clientId };
}

function initializeRequest(): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'issue-215-http-validation', version: '1.0.0' },
    },
  };
}

function mcpRequest(
  accessToken: string | null,
  url = MCP_URL,
  body: Record<string, unknown> = initializeRequest(),
): Promise<Response> {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  });
  if (accessToken !== null) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function expectTokenRejected(accessToken: string): Promise<void> {
  const response = await mcpRequest(accessToken);
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toBe(
    `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
  );
}

test('real HTTP OAuth and MCP release flow uses the Next.js route', async ({ browser }) => {
  expect(process.env['ORBIT_AGENT_IDENTITY_READ']).toBe('true');
  expect(process.env['ORBIT_AGENT_CONSENT']).toBe('true');
  expect(process.env['ORBIT_AGENT_ISSUE_WRITE']).toBe('true');
  expect(process.env['ORBIT_ISSUE_OUTBOX_DISPATCH']).toBe('true');
  const noCredential = await mcpRequest(null);
  expect(noCredential.status).toBe(401);
  expect(noCredential.headers.get('www-authenticate')).toBe(
    `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
  );
  const invalidToken = await mcpRequest('not-a-real-access-token');
  expect(invalidToken.status).toBe(401);
  const metadata = await oauthMetadata();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const liveClients: Awaited<ReturnType<typeof connectOverHttp>>[] = [];
  try {
    await context.route(`${REDIRECT_URI}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'Local OAuth callback received',
      });
    });
    await signIn(page);
    const mainAgentName = `HTTP Researcher ${randomUUID().slice(0, 8)}`;
    const mainToken = await authorizeAgent(page, metadata, mainAgentName);
    const rawInitialize = await mcpRequest(mainToken.accessToken);
    expect(rawInitialize.status).toBe(200);
    const mcp = await connectOverHttp(mainToken.accessToken, MCP_URL);
    liveClients.push(mcp);
    const tools = await mcp.client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'get_me')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'create_issue')).toBe(true);
    const me = meSchema.parse(await mcp.result('get_me'));
    expect(me.actor.id).toBe(me.agent.id);
    expect(me.actor.name).toBe(mainAgentName);
    expect(me.principal.id).not.toBe(me.agent.id);
    expect(me.organization.id.length).toBeGreaterThan(0);
    const team = me.teams[0];
    if (team === undefined) throw new Error('The real MCP identity returned no team.');
    const issueTitle = `HTTP MCP release ${randomUUID().slice(0, 8)}`;
    const created = createdIssueSchema.parse(
      await mcp.result('create_issue', { team: team.key, title: issueTitle, assignee: null }),
    );
    const assigned = updatedIssueSchema.parse(
      await mcp.result('update_issue', {
        issue: created.issue.identifier,
        assignee: 'agent',
      }),
    );
    expect(assigned.changed).toContain('assignee');
    expect(assigned.issue.assigneeAgentId).toBe(me.agent.id);
    const queue = agentQueueSchema.parse(await mcp.result('list_agent_issues'));
    expect(queue.issues.map((issue) => issue.id)).toContain(created.issue.id);
    await page.goto(`${BASE}/team/${team.key.toLowerCase()}/board`);
    await expect(page.getByTestId(`issue-card-${created.issue.identifier}`)).toBeVisible();
    await expect(
      page.getByTestId(`issue-card-${created.issue.identifier}`).getByTestId('issue-creator-agent'),
    ).toHaveText('Agent');
    await page.goto(`${BASE}/issue/${created.issue.identifier}`);
    await expect(page.getByTestId('activity-agent-badge').first()).toContainText(
      `agent for ${me.principal.name}`,
    );
    await mcp.close();
    liveClients.pop();

    await page.goto(`${BASE}/settings/mcp`);
    const mainAgentCard = page.getByTestId(`mcp-agent-${me.agent.id}`).first();
    await mainAgentCard.getByRole('button', { name: 'Pause' }).click();
    await expect(mainAgentCard).toContainText('Lifecycle: disabled');
    await expectTokenRejected(mainToken.accessToken);
    await mainAgentCard.getByRole('button', { name: 'Resume' }).click();
    await expect(mainAgentCard).toContainText('Lifecycle: active');
    const resumedToken = await authorizeAgent(page, metadata, mainAgentName, {
      clientId: mainToken.clientId,
      selectAgentName: mainAgentName,
    });
    const resumedMain = await connectOverHttp(resumedToken.accessToken, MCP_URL);
    liveClients.push(resumedMain);
    expect(meSchema.parse(await resumedMain.result('get_me')).agent.id).toBe(me.agent.id);
    await resumedMain.close();
    liveClients.pop();

    const revokeAgentName = `HTTP revoke ${randomUUID().slice(0, 8)}`;
    const revokedConnection = await authorizeAgent(page, metadata, revokeAgentName);
    const revokeClient = await connectOverHttp(revokedConnection.accessToken, MCP_URL);
    liveClients.push(revokeClient);
    const revokeIdentity = meSchema.parse(await revokeClient.result('get_me'));
    await revokeClient.close();
    liveClients.pop();
    await page.goto(`${BASE}/settings/mcp`);
    const revokeCard = page.getByTestId(`mcp-agent-${revokeIdentity.agent.id}`).first();
    await revokeCard.getByRole('button', { name: 'Revoke connection' }).click();
    await expect(revokeCard).toContainText('Connection: disconnected');
    await expectTokenRejected(revokedConnection.accessToken);

    await page.goto(`${BASE}/settings/mcp`);
    await mainAgentCard.getByRole('button', { name: 'Pause' }).click();
    await expect(mainAgentCard).toContainText('Lifecycle: disabled');
    await expectTokenRejected(resumedToken.accessToken);

    const deletedAgentName = `HTTP delete ${randomUUID().slice(0, 8)}`;
    const deletedConnection = await authorizeAgent(page, metadata, deletedAgentName);
    const deleteClient = await connectOverHttp(deletedConnection.accessToken, MCP_URL);
    liveClients.push(deleteClient);
    const deletedIdentity = meSchema.parse(await deleteClient.result('get_me'));
    await deleteClient.close();
    liveClients.pop();
    await page.goto(`${BASE}/settings/mcp`);
    const deleteCard = page.getByTestId(`mcp-agent-${deletedIdentity.agent.id}`).first();
    await deleteCard.getByLabel(`Reason for deleting ${deletedAgentName}`).fill('release drill');
    await deleteCard.getByRole('button', { name: 'Delete' }).click();
    await expect(deleteCard).toContainText('Lifecycle: deleted');
    await expectTokenRejected(deletedConnection.accessToken);

    await page.goto(`${BASE}/settings/mcp`);
    await mainAgentCard.getByRole('button', { name: 'Resume' }).click();
    await expect(mainAgentCard).toContainText('Lifecycle: active');
    const writerToken = await authorizeAgent(page, metadata, mainAgentName, {
      clientId: mainToken.clientId,
      selectAgentName: mainAgentName,
    });
    const restoredMain = await connectOverHttp(writerToken.accessToken, MCP_URL);
    liveClients.push(restoredMain);
    expect(meSchema.parse(await restoredMain.result('get_me')).agent.id).toBe(me.agent.id);
    await restoredMain.close();
    liveClients.pop();

    const tokenFile = tokenFilePath();
    await writeFile(
      tokenFile,
      JSON.stringify({
        accessToken: writerToken.accessToken,
        agentName: writerToken.agentName,
        clientId: writerToken.clientId,
        agentId: me.agent.id,
        teamKey: team.key,
        issueIdentifier: created.issue.identifier,
        mcpUrl: MCP_URL,
      }),
      { mode: 0o600 },
    );
    console.info(
      JSON.stringify({
        endpoint: MCP_URL,
        resource: metadata.protectedResource.resource,
        issuer: metadata.authorizationServer.issuer,
        dynamicRegistrations: 3,
        authenticatedOAuthFlows: 5,
        toolCalls: ['tools/list', 'get_me', 'create_issue', 'update_issue', 'list_agent_issues'],
        issue: created.issue.identifier,
        lifecycleDenials: 4,
      }),
    );
  } finally {
    await Promise.all(
      liveClients.map(async (client) => await client.close().catch(() => undefined)),
    );
    await context.close();
  }
});
