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
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 12 });
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
  const todo = await stateIdByName(page, teamId, 'Todo');
  const made = await createIssue(page, teamId, `Draggable ${Date.now()}`, todo);
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

test('a card moved with the keyboard updates the aria-live region and lands in the new column', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await page.waitForSelector('[data-testid^="issue-card-"]');
  const teamId = await teamIdByKey(page, 'ENG');
  const todo = await stateIdByName(page, teamId, 'Todo');
  const made = await createIssue(page, teamId, `Keyboard Drag ${Date.now()}`, todo);
  const moving = made.identifier;
  await page.reload();
  const cardLocator = page.locator(`li:has([data-testid="issue-card-${moving}"])`);
  await expect(cardLocator).toBeVisible();
  const ariaLive = page.locator('[id^="DndLiveRegion-"][aria-live="assertive"]');
  const boardStatus = page.getByTestId('board-drag-status');

  await cardLocator.focus();
  await page.keyboard.press('Enter');
  await expect(ariaLive).toContainText(`Picked up ${moving}`, { timeout: 10000 });
  await page.keyboard.press('ArrowRight');
  await expect(ariaLive).toContainText(`Moved ${moving}`, { timeout: 10000 });
  await page.keyboard.press('Enter');
  await expect(boardStatus).toContainText(`Moved ${moving} from column Todo`, { timeout: 10000 });
  await expect(boardStatus).toContainText('to column In Progress');

  await expect
    .poll(async () => await cardsIn(page, 'In Progress'), { timeout: 15_000 })
    .toContain(moving);
  await context.close();
});

test('a keyboard drag can be cancelled with Escape and returns to the original position', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await page.waitForSelector('[data-testid^="issue-card-"]');
  const teamId = await teamIdByKey(page, 'ENG');
  const todo = await stateIdByName(page, teamId, 'Todo');
  const made = await createIssue(page, teamId, `Keyboard Cancel ${Date.now()}`, todo);
  const moving = made.identifier;
  await page.reload();
  const cardLocator = page.locator(`li:has([data-testid="issue-card-${moving}"])`);
  await expect(cardLocator).toBeVisible();
  const ariaLive = page.locator('[id^="DndLiveRegion-"][aria-live="assertive"]');

  await cardLocator.focus();
  await page.keyboard.press('Space');
  await expect(ariaLive).toContainText(`Picked up ${moving}`, { timeout: 10000 });
  await page.keyboard.press('ArrowRight');
  await expect(ariaLive).toContainText(`Moved ${moving}`, { timeout: 10000 });
  await page.keyboard.press('Escape');
  await expect(ariaLive).toContainText(`Cancelled dragging ${moving}`, { timeout: 10000 });
  await expect(ariaLive).toContainText('Returned to column Todo');

  await expect.poll(async () => await cardsIn(page, 'Todo'), { timeout: 15_000 }).toContain(moving);
  await context.close();
});

test('a failed keyboard move announces rollback and leaves the card in place', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  const teamId = await teamIdByKey(page, 'ENG');
  const todo = await stateIdByName(page, teamId, 'Todo');
  const made = await createIssue(page, teamId, `Keyboard Rollback ${Date.now()}`, todo);
  await page.reload();
  const cardLocator = page.locator(`li:has([data-testid="issue-card-${made.identifier}"])`);
  const ariaLive = page.locator('[id^="DndLiveRegion-"][aria-live="assertive"]');
  const boardStatus = page.getByTestId('board-drag-status');
  await expect(cardLocator).toBeVisible();
  await page.route(`**/api/issues/${made.id}/move`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_FAILURE', message: 'Move failed.' } }),
    });
  });

  await cardLocator.focus();
  await page.keyboard.press('Enter');
  await expect(ariaLive).toContainText(`Picked up ${made.identifier}`, { timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await expect(ariaLive).toContainText(`Moved ${made.identifier}`, { timeout: 10_000 });
  await page.keyboard.press('Enter');

  await expect(boardStatus).toContainText(`Failed to move ${made.identifier}`, { timeout: 10_000 });
  await expect(boardStatus).toContainText('Returned to column Todo');
  await expect
    .poll(async () => await cardsIn(page, 'Todo'), { timeout: 15_000 })
    .toContain(made.identifier);
  expect(await cardsIn(page, 'In Progress')).not.toContain(made.identifier);
  expect(await stateIdOf(page, made.identifier)).toBe(todo);
  await context.close();
});

test('a card can be reordered within the same column via keyboard', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await page.waitForSelector('[data-testid^="issue-card-"]');
  const teamId = await teamIdByKey(page, 'ENG');
  const todo = await stateIdByName(page, teamId, 'Todo');
  const first = await createIssue(page, teamId, `Keyboard Reorder A ${Date.now()}`, todo);
  const second = await createIssue(page, teamId, `Keyboard Reorder B ${Date.now()}`, todo);
  const moving = second.identifier;
  await page.reload();
  const cardLocator = page.locator(`li:has([data-testid="issue-card-${moving}"])`);
  await expect(cardLocator).toBeVisible();
  const ariaLive = page.locator('[id^="DndLiveRegion-"][aria-live="assertive"]');
  const boardStatus = page.getByTestId('board-drag-status');

  await expect
    .poll(async () => {
      const rows = await cardsIn(page, 'Todo');
      return rows.indexOf(second.identifier) < rows.indexOf(first.identifier);
    })
    .toBe(true);

  await cardLocator.focus();
  await page.keyboard.press('Space');
  await expect(ariaLive).toContainText(`Picked up ${moving}`, { timeout: 10000 });
  await page.keyboard.press('ArrowDown');
  await expect(ariaLive).toContainText(`Moved ${moving} to column Todo, position 2`, {
    timeout: 10000,
  });
  await page.keyboard.press('Enter');
  await expect(boardStatus).toContainText(`Moved ${moving} from column Todo, position 1`, {
    timeout: 10000,
  });
  await expect(boardStatus).toContainText('to column Todo, position 2');

  await expect
    .poll(async () => {
      const rows = await cardsIn(page, 'Todo');
      return rows.indexOf(first.identifier) < rows.indexOf(second.identifier);
    })
    .toBe(true);

  await page.reload();
  await expect
    .poll(async () => {
      const rows = await cardsIn(page, 'Todo');
      return rows.indexOf(first.identifier) < rows.indexOf(second.identifier);
    })
    .toBe(true);
  await context.close();
});
