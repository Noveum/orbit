import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
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

async function updateIssue(page: Page, issueId: string, patch: Record<string, unknown>) {
  const response = await page.request.patch(`${BASE}/api/issues/${issueId}`, { data: patch });
  expect(response.ok()).toBe(true);
}

async function deleteIssue(page: Page, issueId: string) {
  const response = await page.request.delete(`${BASE}/api/issues/${issueId}`);
  expect(response.ok()).toBe(true);
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error('deferred promise did not initialize');
  return { promise, resolve: resolvePromise };
}

function filterParam(property: string, values: readonly string[]): string {
  const tree = {
    kind: 'group',
    combinator: 'and',
    children: [{ kind: 'condition', property, operator: 'in', values, negate: false }],
  };
  return `filter=${encodeURIComponent(JSON.stringify(tree))}`;
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
  const boardStatus = page.getByTestId('board-drag-status');

  await cardLocator.focus();
  await page.keyboard.press('Enter');
  await expect(boardStatus).toHaveText(
    new RegExp(`Picked up ${moving}: .+ in column Todo, position \\d+ of \\d+\\.`),
    { timeout: 10_000 },
  );
  await page.keyboard.press('ArrowRight');
  await expect(boardStatus).toHaveText(
    new RegExp(`Moved ${moving} to column In Progress, position \\d+ of \\d+\\.`),
    { timeout: 10_000 },
  );
  await page.keyboard.press('Enter');
  await expect(boardStatus).toHaveText(`Moved ${moving} from column Todo to column In Progress.`, {
    timeout: 10_000,
  });

  await expect
    .poll(async () => await cardsIn(page, 'In Progress'), { timeout: 15_000 })
    .toContain(moving);
  await expect(cardLocator).toBeFocused();
  await context.close();
});

test('a filtered My Issues keyboard move announces success and focuses the destination list', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent('/settings/general')}`);
  await page.getByTestId('dev-sign-in-alex@orbit.example').click();
  await page.waitForURL(`${BASE}/settings/general`);
  const bootstrapResponse = await page.request.get(`${BASE}/api/bootstrap`);
  expect(bootstrapResponse.ok()).toBe(true);
  const viewer = z
    .object({ userId: z.string().min(1) })
    .parse(await bootstrapResponse.json()).userId;
  const teamId = await teamIdByKey(page, 'ENG');
  const todo = await stateIdByName(page, teamId, 'Todo');
  const made = await createIssue(page, teamId, `Filtered Keyboard Drag ${Date.now()}`, todo);
  const anchor = await createIssue(page, teamId, `Filtered Keyboard Anchor ${Date.now()}`, todo);
  await updateIssue(page, made.id, { assigneeId: viewer });
  await updateIssue(page, anchor.id, { assigneeId: viewer });
  const preferenceResponse = await page.request.put(`${BASE}/api/view-preferences`, {
    data: { page: 'my_issues', scope: '', layout: 'board', display: {} },
  });
  expect(preferenceResponse.ok()).toBe(true);

  await page.goto(`${BASE}/my-issues?${filterParam('state', [todo])}`);
  await expect(page.getByTestId('my-issues-board')).toBeVisible();
  const card = page.getByRole('listitem', { name: new RegExp(`^${made.identifier}:`) });
  const destinationList = page.getByTestId('board-column-In Progress').locator('ul');
  const boardStatus = page.getByTestId('board-drag-status');
  await expect(card).toBeVisible();
  await expect(destinationList).toBeVisible();

  await card.focus();
  await page.keyboard.press('Enter');
  await expect(boardStatus).toContainText(`Picked up ${made.identifier}`, { timeout: 10_000 });
  await expect(async () => {
    await page.keyboard.press('ArrowRight');
    await expect(boardStatus).toContainText(`Moved ${made.identifier} to column In Progress`, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press('Enter');

  await expect(boardStatus).toHaveText(
    `Moved ${made.identifier} from column Todo to column In Progress.`,
    { timeout: 10_000 },
  );
  await expect(card).toHaveCount(0);
  await expect(destinationList).toBeFocused();
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
  const boardStatus = page.getByTestId('board-drag-status');
  let moveRequestCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/api/issues/${made.id}/move`)) {
      moveRequestCount += 1;
    }
  });

  await cardLocator.focus();
  await page.keyboard.press('Space');
  await expect(boardStatus).toContainText(`Picked up ${moving}`, { timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await expect(boardStatus).toContainText(`Moved ${moving}`, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(boardStatus).toContainText(`Cancelled dragging ${moving}`, { timeout: 10_000 });
  await expect(boardStatus).toContainText('Returned to column Todo');
  expect(moveRequestCount).toBe(0);

  await expect.poll(async () => await cardsIn(page, 'Todo'), { timeout: 15_000 }).toContain(moving);

  const remote = await context.newPage();
  await remote.goto(`${BASE}/my-issues`);
  const inProgress = await stateIdByName(remote, teamId, 'In Progress');
  const cardBox = await page.getByTestId(`issue-card-${moving}`).boundingBox();
  if (cardBox === null) throw new Error('the card has no box');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 8, cardBox.y + cardBox.height / 2, {
    steps: 4,
  });
  await expect(boardStatus).toContainText(`Picked up ${moving}`);
  await updateIssue(remote, made.id, { stateId: inProgress });
  await expect(boardStatus).toContainText(`${moving} moved in the background`, {
    timeout: 15_000,
  });
  await expect(boardStatus).toHaveText(
    new RegExp(
      `${moving} moved in the background to column In Progress, position \\d+(?: of \\d+)?\\. Drag cancelled\\.`,
    ),
  );
  await expect(cardLocator).toBeFocused();
  await page.mouse.up();
  await page.mouse.move(0, 0);
  expect(moveRequestCount).toBe(0);

  const regroupedCard = page.locator(`li:has([data-testid="issue-card-${moving}"])`);
  await regroupedCard.focus();
  await page.keyboard.press('Enter');
  await expect(boardStatus).toContainText(`Picked up ${moving}`);
  await expect(boardStatus).toContainText('in column In Progress');
  await deleteIssue(remote, made.id);
  await expect(boardStatus).toHaveText(`${moving} is no longer visible. Drag cancelled.`, {
    timeout: 15_000,
  });
  await expect(regroupedCard).toHaveCount(0);
  expect(moveRequestCount).toBe(0);
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
  const boardStatus = page.getByTestId('board-drag-status');
  await expect(cardLocator).toBeVisible();
  const failure = deferred();
  await page.route(`**/api/issues/${made.id}/move`, async (route) => {
    await failure.promise;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_FAILURE', message: 'Move failed.' } }),
    });
  });

  await cardLocator.focus();
  await page.keyboard.press('Enter');
  await expect(boardStatus).toContainText(`Picked up ${made.identifier}`, { timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await expect(boardStatus).toContainText(`Moved ${made.identifier}`, { timeout: 10_000 });
  await page.keyboard.press('Enter');

  await expect(boardStatus).toContainText(`Dropping ${made.identifier}`, { timeout: 10_000 });
  await expect
    .poll(async () => await cardsIn(page, 'In Progress'), { timeout: 15_000 })
    .toContain(made.identifier);
  await expect(
    page.getByRole('listitem', { name: new RegExp(`^${made.identifier}:`) }),
  ).toHaveAttribute('aria-disabled', 'true');
  failure.resolve();
  await expect(boardStatus).toContainText(`Failed to move ${made.identifier}`, { timeout: 10_000 });
  await expect(boardStatus).toContainText('Returned to column Todo');
  await expect
    .poll(async () => await cardsIn(page, 'Todo'), { timeout: 15_000 })
    .toContain(made.identifier);
  expect(await cardsIn(page, 'In Progress')).not.toContain(made.identifier);
  expect(await stateIdOf(page, made.identifier)).toBe(todo);
  await expect(
    page.getByRole('listitem', { name: new RegExp(`^${made.identifier}:`) }),
  ).toBeFocused();
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
  const boardStatus = page.getByTestId('board-drag-status');

  await expect
    .poll(async () => {
      const rows = await cardsIn(page, 'Todo');
      return rows.indexOf(second.identifier) < rows.indexOf(first.identifier);
    })
    .toBe(true);

  await cardLocator.focus();
  await page.keyboard.press('Space');
  await expect(boardStatus).toContainText(`Picked up ${moving}`, { timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await expect(boardStatus).toContainText(`Moved ${moving} to column Todo, position 2`, {
    timeout: 10_000,
  });
  await page.keyboard.press('Enter');
  await expect(boardStatus).toHaveText(`Moved ${moving} from column Todo to column Todo.`, {
    timeout: 10_000,
  });

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
