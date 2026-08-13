import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { completeSprint, createSprint } from './api.ts';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('a sprint can be opened and closed, and its outcome survives the rollover', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/sprints`);
  await expect(page.getByTestId('sprint-tabs').first()).toBeVisible();
  await expect(page.getByTestId('sprint-name').first()).toBeVisible();

  const label = `Regression sprint ${Date.now()}`;
  const sprint = await createSprint(page, label);

  await completeSprint(page, sprint.id);

  await page.goto(`${BASE}/sprints`);
  const entry = page.getByTestId(`sprint-history-${sprint.number}`).first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(label);

  await entry.click();
  await expect(page).toHaveURL(`${BASE}/sprints?sprint=${sprint.number}`);
  await expect(page.getByTestId('sprint-outcome').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(label);

  await context.close();
});

test('the sprint a team page points at is the sprint of the workspace', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/cycles`);
  await expect(page).toHaveURL(`${BASE}/sprints`);

  await page.goto(`${BASE}/team/eng/sprint/active`);
  await expect(page).toHaveURL(`${BASE}/sprints`);

  await page.goto(`${BASE}/team/eng/sprint/1`);
  await expect(page).toHaveURL(`${BASE}/sprints`);

  await context.close();
});

test('the sprint board is the board every other surface uses, not one of its own', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/sprints`);
  await expect(page.getByTestId('sprint-issues')).toBeVisible();

  const column = page.locator('[data-testid^="board-column-"]').first();
  await expect(column).toBeVisible();

  const card = page.locator('[data-testid^="issue-card-"]').first();
  await expect(card).toBeVisible();

  await expect(page.getByTestId('filter-bar').first()).toBeVisible();

  await page.goto(`${BASE}/sprints?tab=list`);
  await expect(page.getByTestId('sprint-issues')).toBeVisible();
  await expect(page.getByTestId('issue-list').first()).toBeVisible();

  await context.close();
});

test('a sprint whose tasks fail to load says so instead of looking empty', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await signIn(context, 'alex@orbit.example');

  let failing = true;
  await page.route('**/api/issues?**', async (route) => {
    if (failing) return await route.fulfill({ status: 500, body: '{"error":"boom"}' });
    return await route.continue();
  });

  await page.goto(`${BASE}/sprints`);
  const retry = page.getByTestId('retry-sprint-issues');
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('sprint-issues')).not.toContainText('Nothing in this sprint yet');

  failing = false;
  await retry.click();
  await expect(page.locator('[data-testid^="board-column-"]').first()).toBeVisible();

  await context.close();
});

test('a filter change whose request fails says so rather than showing the old board', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await signIn(context, 'alex@orbit.example');

  let failing = false;
  await page.route('**/api/issues?**', async (route) => {
    if (failing) return await route.fulfill({ status: 500, body: '{"error":"boom"}' });
    return await route.continue();
  });

  await page.goto(`${BASE}/sprints`);
  await expect(page.locator('[data-testid^="board-column-"]').first()).toBeVisible();

  failing = true;
  await page.keyboard.press('f');
  await expect(page.getByTestId('filter-menu')).toBeVisible();
  await page.getByTestId('filter-field-priority').click();
  await page.getByTestId('filter-value-1').click();
  await page.keyboard.press('Escape');

  const retry = page.getByTestId('retry-sprint-issues');
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sprint-issues')).not.toContainText('Nothing in this sprint yet');
  await expect(page.locator('[data-testid^="board-column-"]')).toHaveCount(0);

  failing = false;
  await retry.click();
  await expect(page.locator('[data-testid^="board-column-"]').first()).toBeVisible();

  await context.close();
});
