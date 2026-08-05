import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const SHOTS =
  '/private/tmp/claude-501/-Users-shashank-Projects-Noveum-orbit/05049b9c-74ec-484a-a1f0-61aeb4a59999/scratchpad';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('the peek paints immediately and docs need no save button', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await signIn(context, 'pulkit@noveum.ai');

  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.locator('[data-testid^="issue-card-"]').first()).toBeVisible();

  const card = page.locator('[data-testid^="issue-card-"]').first();
  const identifier = ((await card.getAttribute('data-testid')) ?? '').replace('issue-card-', '');

  const started = Date.now();
  await card.locator('a').first().click();
  const peek = page.getByTestId('issue-peek');
  await expect(peek).toBeVisible();
  await expect(peek.getByTestId('issue-title')).not.toHaveValue('', { timeout: 2_000 });
  const painted = Date.now() - started;
  console.log(`PEEK_PAINTED_MS=${painted} for ${identifier}`);
  await page.screenshot({ path: `${SHOTS}/peek-instant.png` });
  expect(painted).toBeLessThan(1_500);

  await page.keyboard.press('Escape');

  const filterStart = Date.now();
  const facetsResponse = page.waitForResponse((res) => res.url().includes('/api/issues/facets'), {
    timeout: 30_000,
  });
  await page.goto(`${BASE}/team/eng/issues`);
  const facets = await facetsResponse;
  console.log(`FACETS_STATUS=${facets.status()} in ${Date.now() - filterStart}ms`);
  expect(facets.status()).toBe(200);

  await page.goto(`${BASE}/docs`);
  await expect(page.getByTestId('docs-workspace')).toBeVisible();
  await page.getByText('Realtime delta protocol').click();
  await expect(page.getByTestId('doc-rich-editor')).toBeVisible();
  await expect(page.getByTestId('doc-edit-toggle')).toHaveCount(0);
  await expect(page.getByTestId('doc-save-status')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/doc-always-edit.png`, fullPage: false });

  await context.close();
});
