import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('two viewers see issue, board and comment changes without reloading', async ({ browser }) => {
  test.setTimeout(180_000);

  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const author = await signIn(first, 'pulkit@noveum.ai');
  const watcher = await signIn(second, 'shashank@noveum.ai');

  await author.goto(`${BASE}/team/eng/board`);
  await expect(author.getByTestId('board-column-Todo')).toBeVisible();
  await author.screenshot({ path: `${SHOTS}/board.png` });

  await watcher.goto(`${BASE}/team/eng/board`);
  await expect(watcher.getByTestId('board-column-Todo')).toBeVisible();

  const title = `E2E issue ${Date.now() % 100000}`;
  await author.keyboard.press('c');
  await expect(author.getByTestId('quick-create')).toBeVisible();
  await author.getByTestId('quick-create-title').fill(title);
  await author.getByTestId('quick-create-submit').click();
  await expect(author.getByText(title)).toBeVisible();

  await expect(watcher.getByText(title)).toBeVisible({ timeout: 20_000 });

  const identifier = (
    (await author.locator('article', { hasText: title }).first().getAttribute('data-testid')) ?? ''
  ).replace('issue-card-', '');

  const card = author.getByTestId(`issue-card-${identifier}`);
  const target = author.getByTestId('board-column-In Progress');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  if (from === null || to === null) return;

  await author.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await author.mouse.down();
  await author.mouse.move(from.x + from.width / 2 + 30, from.y + 20, { steps: 8 });
  await author.mouse.move(to.x + to.width / 2, to.y + 260, { steps: 20 });
  await author.mouse.up();

  await expect(author.getByTestId('board-column-In Progress').getByText(title)).toBeVisible();
  await expect(watcher.getByTestId('board-column-In Progress').getByText(title)).toBeVisible({
    timeout: 20_000,
  });

  await author.goto(`${BASE}/issue/${identifier}`);
  await expect(author.getByTestId('issue-detail')).toBeVisible();
  await author.getByTestId('comment-composer').fill('Shipping this one.');
  await author.getByTestId('comment-composer-submit').click();
  await expect(author.getByText('Shipping this one.')).toBeVisible();

  await watcher.goto(`${BASE}/issue/${identifier}`);
  await expect(watcher.getByText('Shipping this one.')).toBeVisible({ timeout: 20_000 });

  const commentId = (
    (await watcher
      .locator('article[data-testid^="comment-"]')
      .first()
      .getAttribute('data-testid')) ?? ''
  ).replace('comment-', '');
  await watcher.getByTestId(`add-reaction-${commentId}`).click();
  await watcher.getByTestId('pick-reaction-🎉').click();

  await expect(author.getByTestId('reaction-🎉')).toBeVisible({ timeout: 20_000 });
  await author.screenshot({ path: `${SHOTS}/issue-detail.png` });

  await first.close();
  await second.close();
});
