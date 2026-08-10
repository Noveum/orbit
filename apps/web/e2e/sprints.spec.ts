import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { completeSprint, createSprint, teamIdByKey } from './api.ts';
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
  await expect(page.getByRole('heading', { name: 'Sprints', level: 1 })).toBeVisible();

  const teamId = await teamIdByKey(page, 'ENG');

  const label = `Regression sprint ${Date.now()}`;
  const sprint = await createSprint(page, teamId, label);

  await completeSprint(page, sprint.id);

  await page.goto(`${BASE}/sprints`);
  const engPanels = page.getByTestId(`sprint-history-eng-${sprint.number}`);
  await expect(engPanels).toHaveCount(1);
  const entry = engPanels.first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(label);

  await entry.click();
  await expect(page).toHaveURL(`${BASE}/team/eng/sprint/${sprint.number}`);
  await expect(page.getByTestId('sprint-outcome')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(label);

  await context.close();
});

test('the old cycle urls still land on the sprint pages', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/cycles`);
  await expect(page).toHaveURL(`${BASE}/sprints`);

  await page.goto(`${BASE}/team/eng/cycle/active`);
  await expect(page).toHaveURL(`${BASE}/team/eng/sprint/active`);

  await context.close();
});
