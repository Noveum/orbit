import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { createIssue, stateIdByName, stateIdOf, teamIdByKey } from './api.ts';
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

test('a card dragged to another column lands there and stays after a reload', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await page.waitForSelector('[data-testid^="issue-card-"]');

  const teamId = await teamIdByKey(page, 'ENG');
  const made = await createIssue(page, teamId, `Draggable ${Date.now()}`);
  const moving = made.identifier;

  await page.reload();
  await page.waitForSelector(`[data-testid="issue-card-${moving}"]`);
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
  await expect.poll(async () => await cardsIn(page, 'Todo')).not.toContain(moving);

  await context.close();
});

test('the command palette finds an issue by its title and opens it', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/team/eng/board`);
  await page.waitForSelector('[data-testid^="issue-card-"]');

  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const input = dialog.locator('input').first();
  await input.fill('websocket');

  const result = dialog.locator('[data-testid^="palette-issue-"]').first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();

  await expect(page).toHaveURL(/\/issue\/[A-Z]+-\d+/);
  await context.close();
});
