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
