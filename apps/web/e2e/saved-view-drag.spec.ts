import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { createBoardView, createIssue, stateIdByName, stateIdOf, teamIdByKey } from './api.ts';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function cardsIn(page: Page, column: string): Promise<string[]> {
  return await page.evaluate((name) => {
    const columns = [...document.querySelectorAll('[data-testid^="board-column-"]')];
    const found = columns.find((node) => node.querySelector('h2')?.textContent?.trim() === name);
    if (found === undefined) return [];
    return [...found.querySelectorAll('[data-testid^="issue-card-"]')].map((card) =>
      (card.getAttribute('data-testid') ?? '').replace('issue-card-', ''),
    );
  }, column);
}

async function dragCardToColumn(page: Page, identifier: string, column: string): Promise<void> {
  const card = page.getByTestId(`issue-card-${identifier}`);
  const target = page.locator('[data-testid^="board-column-"]').filter({ hasText: column }).first();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('the card or the column has no box');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + (to.x + to.width / 2 - from.x) * (step / steps),
      from.y + (to.y + 120 - from.y) * (step / steps),
    );
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
}

test('a card dragged between columns on a saved view lands there and is saved', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/my-issues`);
  const teamId = await teamIdByKey(page, 'ENG');
  const view = await createBoardView(page, teamId, `Board view ${Date.now()}`);
  const made = await createIssue(page, teamId, `View drag ${Date.now()}`);
  const moving = made.identifier;

  await page.goto(`${BASE}/views/${view.id}`);
  await expect(page.getByTestId('saved-view-board')).toBeVisible();
  await page.waitForSelector(`[data-testid="issue-card-${moving}"]`, { timeout: 30_000 });

  const progressBefore = await cardsIn(page, 'In Progress');
  await dragCardToColumn(page, moving, 'In Progress');

  await expect
    .poll(async () => await cardsIn(page, 'In Progress'), { timeout: 15_000 })
    .toContain(moving);
  expect(await cardsIn(page, 'Todo')).not.toContain(moving);
  expect((await cardsIn(page, 'In Progress')).length).toBe(progressBefore.length + 1);

  const inProgress = await stateIdByName(page, teamId, 'In Progress');
  await expect
    .poll(async () => await stateIdOf(page, moving), { timeout: 30_000 })
    .toBe(inProgress);

  await page.reload();
  await page.waitForSelector('[data-testid^="issue-card-"]');
  await expect
    .poll(async () => await cardsIn(page, 'In Progress'), { timeout: 45_000 })
    .toContain(moving);

  await context.close();
});

test('every column shows on a saved view board, even the empty ones', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/my-issues`);
  const teamId = await teamIdByKey(page, 'ENG');
  const view = await createBoardView(page, teamId, `All columns ${Date.now()}`);

  await page.goto(`${BASE}/views/${view.id}`);
  await expect(page.getByTestId('saved-view-board')).toBeVisible();

  for (const column of ['Backlog', 'Todo', 'In Progress', 'Done']) {
    await expect(page.getByTestId(`board-column-${column}`)).toBeVisible();
  }

  await context.close();
});
