import { createHash } from 'node:crypto';
import { newId } from '@orbit/core';
import { and, asc, db, eq, isNull, schema } from '@orbit/db';
import { mcpTokenResponseSchema } from '@orbit/shared/validators';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { connect } from '../../../packages/mcp-server/src/test-helpers.ts';
import { BASE } from './base-url.ts';

const DEMO_EMAIL = 'alex@orbit.example';
const subscribedFrameSchema = z.object({
  type: z.literal('subscribed'),
  scopes: z.array(z.string()),
});

function teamSubscription(page: Page): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handleWebSocket = (socket: import('@playwright/test').WebSocket) => {
      socket.on('framereceived', ({ payload }) => {
        if (settled || typeof payload !== 'string') return;
        let value: unknown;
        try {
          value = JSON.parse(payload);
        } catch {
          return;
        }
        const parsed = subscribedFrameSchema.safeParse(value);
        if (!(parsed.success && parsed.data.scopes.some((scope) => scope.startsWith('team:')))) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        page.off('websocket', handleWebSocket);
        resolve();
      });
    };
    const timeout = setTimeout(() => {
      settled = true;
      page.off('websocket', handleWebSocket);
      reject(new Error('realtime did not subscribe to a team scope'));
    }, 15_000);
    page.on('websocket', handleWebSocket);
  });
}

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`, { waitUntil: 'domcontentloaded' });
  return page;
}

test('the MCP server page is one click from the workspace menu', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await signIn(context, DEMO_EMAIL);

  await page.getByTestId('workspace-switcher').click();
  await page.getByTestId('mcp-link').click();
  await page.waitForURL(`${BASE}/settings/mcp`);

  await expect(page.getByTestId('mcp-url')).toBeVisible();
  await expect(page.getByTestId('mcp-url')).toContainText('/mcp');

  for (const id of ['claude', 'chatgpt', 'claude-code', 'cursor', 'vscode', 'other']) {
    await expect(page.getByTestId(`mcp-client-${id}`)).toBeVisible();
  }

  await expect(page.getByRole('link', { name: 'Add to Cursor' })).toHaveAttribute(
    'href',
    /^cursor:\/\//,
  );

  await context.close();
});

test('OAuth consent creates an agent that can be managed from MCP settings', async ({
  browser,
}) => {
  const [seed] = await db
    .select({ userId: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.email, DEMO_EMAIL))
    .limit(1);
  if (seed === undefined) throw new Error('The E2E demo account has no workspace.');

  const clientId = `e2e-${newId()}`;
  const consentCode = `consent-${newId()}`;
  const agentName = `E2E Researcher ${newId().slice(0, 8)}`;
  const codeVerifier = `${newId()}${newId()}`.replaceAll('-', '');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const redirectUri = 'http://127.0.0.1:9876/callback';
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Orbit E2E Client',
    redirectUrls: redirectUri,
    type: 'public',
    userId: seed.userId,
  });
  await db.insert(schema.verification).values({
    id: newId(),
    identifier: consentCode,
    value: JSON.stringify({
      clientId,
      redirectURI: redirectUri,
      scope: ['orbit.read', 'orbit.write'],
      userId: seed.userId,
      requireConsent: true,
      state: 'orbit-e2e',
      codeChallenge,
      codeChallengeMethod: 'S256',
    }),
    expiresAt: new Date(Date.now() + 600_000),
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await signIn(context, DEMO_EMAIL);
  await context.route(/^http:\/\/127\.0\.0\.1:9876\/callback/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'OAuth callback received',
    });
  });
  await page.goto(`${BASE}/oauth/authorize?consent_code=${encodeURIComponent(consentCode)}`);
  const organizationId = await page.getByLabel('Workspace').inputValue();
  if (organizationId.length === 0) throw new Error('OAuth consent did not select a workspace.');
  await page.getByLabel('Agent identity').selectOption({ label: 'Create a new agent' });
  await page.getByLabel('Agent name').fill(agentName);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForURL(/127\.0\.0\.1:9876\/callback\?code=/);
  await expect(page.getByText('OAuth callback received')).toBeVisible();
  const authorizationCode = new URL(page.url()).searchParams.get('code');
  if (authorizationCode === null)
    throw new Error('OAuth consent did not return an authorization code.');

  const identities = await db
    .select()
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.ownerUserId, seed.userId),
        eq(schema.agentIdentity.organizationId, organizationId),
        eq(schema.agentIdentity.clientId, clientId),
        eq(schema.agentIdentity.name, agentName),
      ),
    );
  expect(identities).toHaveLength(1);
  const identity = identities[0];
  if (identity === undefined) throw new Error('OAuth consent did not create the selected agent.');
  const grants = await db
    .select()
    .from(schema.mcpGrant)
    .where(
      and(
        eq(schema.mcpGrant.agentIdentityId, identity.id),
        eq(schema.mcpGrant.clientId, clientId),
        eq(schema.mcpGrant.userId, seed.userId),
        eq(schema.mcpGrant.organizationId, organizationId),
        isNull(schema.mcpGrant.revokedAt),
      ),
    );
  expect(grants).toHaveLength(1);
  const grant = grants[0];
  expect(grant?.scopes).toBe('orbit.read orbit.write');

  const tokenResponse = await page.request.post(`${BASE}/api/auth/mcp/token`, {
    form: {
      grant_type: 'authorization_code',
      code: authorizationCode,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    },
  });
  if (!tokenResponse.ok()) {
    throw new Error(`OAuth token exchange answered ${tokenResponse.status()}.`);
  }
  const token = mcpTokenResponseSchema.parse(await tokenResponse.json());
  const agent = await connect(token.access_token);
  const teams = await db
    .select({ key: schema.team.key })
    .from(schema.team)
    .where(eq(schema.team.organizationId, organizationId))
    .orderBy(asc(schema.team.key));
  const team = teams[0];
  if (team === undefined) throw new Error('The selected workspace has no team.');
  const title = `OAuth agent issue ${newId().slice(0, 8)}`;

  const board = await context.newPage();
  const subscribed = teamSubscription(board);
  await board.goto(`${BASE}/team/${team.key.toLowerCase()}/board`);
  await expect(board.locator('[data-testid^="board-column-"]').first()).toBeVisible();
  await subscribed;
  const issueCountBefore = async (): Promise<number> => {
    const counts = await board
      .locator('[data-testid^="board-column-"] header [data-numeric]')
      .allTextContents();
    return counts.reduce((total, count) => total + Number(count), 0);
  };
  const countBefore = await issueCountBefore();

  const created = await agent.result('create_issue', {
    team: team.key,
    title,
    assignee: null,
  });
  const issue = created['issue'] as { id: string; identifier: string };
  const assigned = await agent.result('update_issue', {
    issue: issue.identifier,
    assignee: 'agent',
  });
  expect(assigned['changed']).toContain('assignee');
  expect((assigned['issue'] as { assigneeAgentId: string | null }).assigneeAgentId).toBe(
    identity.id,
  );
  const queue = await agent.result('list_agent_issues');
  expect((queue['issues'] as { id: string }[]).map((entry) => entry.id)).toContain(issue.id);
  const searched = await agent.result('search_issues', { query: title, assignee: 'agent' });
  expect((searched['issues'] as { id: string }[]).map((entry) => entry.id)).toContain(issue.id);
  await expect.poll(issueCountBefore, { timeout: 20_000 }).toBe(countBefore + 1);
  await expect(board.getByTestId(`issue-card-${issue.identifier}`)).toBeVisible();
  await expect(
    board.getByTestId(`issue-card-${issue.identifier}`).getByTestId('issue-creator-agent'),
  ).toHaveText('Agent');

  await board.goto(`${BASE}/issue/${issue.identifier}`);
  await expect(board.getByTestId('issue-detail')).toBeVisible();
  await expect(board.getByTestId('activity-agent-badge').first()).toContainText(
    `agent for ${seed.name}`,
  );
  await board.goto(`${BASE}/inbox`);
  await expect(board.getByTestId('inbox-detail')).toBeVisible();
  await board.getByRole('button', { name: 'Status' }).click();
  const notification = board
    .getByRole('button')
    .filter({ hasText: `Assigned you ${issue.identifier}` });
  await expect(notification).toContainText('Agent');
  await expect(notification).toContainText(agentName);

  await page.goto(`${BASE}/settings/mcp`);
  const card = page.getByTestId(`mcp-agent-${identity.id}`);
  await expect(card).toContainText(agentName);
  await card.getByRole('button', { name: 'Pause' }).click();
  await expect(card).toContainText('Lifecycle: disabled');
  await card.getByRole('button', { name: 'Resume' }).click();
  await expect(card).toContainText('Lifecycle: active');
  await agent.close();
  await context.close();
});

test('an HTML page can be started straight from the docs pane', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 700 } });
  const page = await signIn(context, DEMO_EMAIL);

  await page.goto(`${BASE}/docs`);
  for (const testId of ['doc-templates', 'doc-import', 'new-html-page', 'new-doc']) {
    await expect(page.getByTestId(testId).first()).toBeInViewport();
  }
  await page.getByTestId('new-html-page').first().click();
  await page.waitForURL(/\/docs\/[^/]+$/);

  await expect(page.getByTestId('html-preview')).toBeVisible();

  await context.close();
});
