import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { stateIdByName, teamIdByKey } from './api.ts';
import { BASE } from './base-url.ts';

const cyclesSchema = z.object({
  cycles: z.array(z.object({ id: z.string(), completedAt: z.string().nullable() })),
});

const issueSchema = z.object({ issue: z.object({ id: z.string() }) });

const sprintSummarySchema = z.object({
  current: z.object({ summary: z.object({ completed: z.number(), remaining: z.number() }) }),
});

async function json(page: Page, path: string, init?: RequestInit): Promise<unknown> {
  return await page.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, options as RequestInit);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return (await response.json()) as unknown;
    },
    { url: path, options: init ?? {} },
  );
}

async function signIn(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-alex@orbit.example').click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('analytics is useful by default and preserves planning choices on reload', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context);

  await page.goto(`${BASE}/analytics`);
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel(/Reporting range/)).toContainText('Active sprint');

  await page.getByLabel('Measure').click();
  await page.getByRole('option', { name: 'Points' }).click();
  await page.getByLabel(/Reporting range/).click();
  await page.getByRole('button', { name: 'Last 90 days' }).click();
  await page.getByRole('tab', { name: 'People' }).click();

  await expect(page).toHaveURL(/lens=people/);
  await expect(page).toHaveURL(/measure=points/);
  await expect(page).toHaveURL(/range=last_90_days/);
  await expect(page.getByText('My work')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Measure')).toContainText('Points');

  await context.close();
});

test('analytics and the sprint page share sprint truth and expose exact hover values', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context);

  await page.goto(`${BASE}/sprints`);
  const sprintName = (await page.getByTestId('sprint-name').first().textContent())?.trim();
  if (sprintName === undefined || sprintName.length === 0) throw new Error('missing sprint name');

  await page.goto(`${BASE}/analytics?lens=sprints`);
  await expect(page.getByText(sprintName, { exact: true }).first()).toBeVisible();
  await expect(page.locator('figcaption').getByText('Sprint burn down')).toBeVisible();
  await expect(page.getByText('Flow time')).toBeVisible();
  await expect(page.getByText(/Current issue-row creation to durable completion/)).toBeVisible();
  await expect(page.getByText(/Current mutable startedAt column to completion/)).toBeVisible();

  const point = page.locator('[data-testid^="plot-hit-"]').last();
  await point.hover({ force: true });
  await expect(page.getByRole('tooltip')).toBeVisible();

  const chart = page.getByRole('application', { name: 'Sprint burn down' });
  await chart.focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tooltip')).toBeVisible();

  await context.close();
});

test('the active sprint burn changes when live work completes', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context);
  const teamId = await teamIdByKey(page, 'ENG');
  const todoId = await stateIdByName(page, teamId, 'Todo');
  const doneId = await stateIdByName(page, teamId, 'Done');
  const cycles = cyclesSchema.parse(await json(page, '/api/cycles')).cycles;
  const activeCycle = cycles.find((cycle) => cycle.completedAt === null);
  if (activeCycle === undefined) throw new Error('missing active sprint');
  const created = issueSchema.parse(
    await json(page, '/api/issues', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId,
        title: `Live burn evidence ${Date.now()}`,
        stateId: todoId,
        cycleId: activeCycle.id,
      }),
    }),
  ).issue;
  const before = sprintSummarySchema.parse(await json(page, '/api/analytics/sprints')).current
    .summary;

  await json(page, `/api/issues/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stateId: doneId }),
  });
  const after = sprintSummarySchema.parse(await json(page, '/api/analytics/sprints')).current
    .summary;

  expect(after.completed).toBe(before.completed + 1);
  expect(after.remaining).toBe(before.remaining - 1);
  await context.close();
});

test('a complete analytics view can be saved, pinned, and restored', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context);
  const name = `Planning view ${Date.now()}`;

  await page.goto(`${BASE}/analytics?lens=projects&measure=points&range=last_90_days`);
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByLabel('Analytics view name').fill(name);
  await page.getByLabel('Share with workspace').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByLabel(`Pin ${name}`).click();
  await expect(page.getByLabel(`Unpin ${name}`)).toBeVisible();

  await page.goto(`${BASE}/analytics`);
  await expect(page.getByRole('tab', { name: 'Projects' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Measure')).toContainText('Points');
  await expect(page.getByLabel(/Reporting range/)).toContainText('Last 90 days');

  await context.close();
});
