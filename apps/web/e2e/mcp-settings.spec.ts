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
