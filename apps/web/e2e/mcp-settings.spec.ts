import { newId } from '@orbit/core';
import { and, db, eq, isNull, schema } from '@orbit/db';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const DEMO_EMAIL = 'alex@orbit.example';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
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
    .select({ userId: schema.user.id, organizationId: schema.member.organizationId })
    .from(schema.user)
    .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.user.email, DEMO_EMAIL))
    .limit(1);
  if (seed === undefined) throw new Error('The E2E demo account has no workspace.');

  const clientId = `e2e-${newId()}`;
  const consentCode = `consent-${newId()}`;
  const agentName = `E2E Researcher ${newId().slice(0, 8)}`;
  await db.insert(schema.oauthApplication).values({
    id: newId(),
    clientId,
    name: 'Orbit E2E Client',
    redirectUrls: 'http://127.0.0.1:9876/callback',
    type: 'public',
    userId: seed.userId,
  });
  await db.insert(schema.verification).values({
    id: newId(),
    identifier: consentCode,
    value: JSON.stringify({
      clientId,
      redirectURI: 'http://127.0.0.1:9876/callback',
      scope: ['orbit.read', 'orbit.write'],
      userId: seed.userId,
      requireConsent: true,
      state: 'orbit-e2e',
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
  await page.getByLabel('Agent identity').selectOption({ label: 'Create a new agent' });
  await page.getByLabel('Agent name').fill(agentName);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForURL(/127\.0\.0\.1:9876\/callback\?code=/);
  await expect(page.getByText('OAuth callback received')).toBeVisible();

  const [identity] = await db
    .select()
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.ownerUserId, seed.userId),
        eq(schema.agentIdentity.organizationId, seed.organizationId),
        eq(schema.agentIdentity.name, agentName),
      ),
    )
    .limit(1);
  if (identity === undefined) throw new Error('OAuth consent did not create the selected agent.');
  const [grant] = await db
    .select()
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.agentIdentityId, identity.id), isNull(schema.mcpGrant.revokedAt)))
    .limit(1);
  expect(grant?.scopes).toBe('orbit.read orbit.write');

  await page.goto(`${BASE}/settings/mcp`);
  const card = page.getByTestId(`mcp-agent-${identity.id}`);
  await expect(card).toContainText(agentName);
  await card.getByRole('button', { name: 'Pause' }).click();
  await expect(card).toContainText('Lifecycle: disabled');
  await card.getByRole('button', { name: 'Resume' }).click();
  await expect(card).toContainText('Lifecycle: active');
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
