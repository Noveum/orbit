import { expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';
const PROPAGATION_TIMEOUT = 20_000;

async function openBoard(page: Page): Promise<void> {
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
}

test('one user in two tabs of the same browser sees issues, comments and reactions live', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });

  const tabA = await context.newPage();
  await tabA.goto(`${BASE}/login`);
  await tabA.getByTestId('dev-sign-in-pulkit@noveum.ai').click();
  await tabA.waitForURL(`${BASE}/my-issues`);

  const tabB = await context.newPage();
  await openBoard(tabA);
  await openBoard(tabB);

  const title = `Same user tabs ${Date.now() % 1000000}`;
  await tabA.keyboard.press('c');
  await expect(tabA.getByTestId('quick-create')).toBeVisible();
  await tabA.getByTestId('quick-create-title').fill(title);
  await tabA.getByTestId('quick-create-submit').click();
  await expect(tabA.getByText(title)).toBeVisible();

  await expect(tabB.getByText(title)).toBeVisible({ timeout: PROPAGATION_TIMEOUT });
  await expect(tabA.getByTestId('quick-create')).toBeHidden();
  await tabA.screenshot({ path: `${SHOTS}/same-user-tab-a.png` });
  await tabB.screenshot({ path: `${SHOTS}/same-user-tab-b.png` });

  const identifier = (
    (await tabA.locator('article', { hasText: title }).first().getAttribute('data-testid')) ?? ''
  ).replace('issue-card-', '');
  expect(identifier).not.toBe('');

  await tabA.goto(`${BASE}/issue/${identifier}`);
  await expect(tabA.getByTestId('issue-detail')).toBeVisible();
  await tabB.goto(`${BASE}/issue/${identifier}`);
  await expect(tabB.getByTestId('issue-detail')).toBeVisible();

  const body = `Comment from the other tab ${Date.now() % 1000000}`;
  await tabA.getByTestId('comment-composer').fill(body);
  await tabA.getByTestId('comment-composer-submit').click();
  await expect(tabA.getByText(body)).toBeVisible();

  await expect(tabB.getByText(body)).toBeVisible({ timeout: PROPAGATION_TIMEOUT });

  const commentId = (
    (await tabA.locator('article[data-testid^="comment-"]').last().getAttribute('data-testid')) ??
    ''
  ).replace('comment-', '');
  expect(commentId).not.toBe('');

  await tabA.getByTestId(`add-reaction-${commentId}`).click();
  await tabA.getByTestId('pick-reaction-🎉').click();
  await expect(tabA.getByTestId('reaction-🎉')).toBeVisible();

  await expect(tabB.getByTestId('reaction-🎉')).toBeVisible({ timeout: PROPAGATION_TIMEOUT });
  await tabA.screenshot({ path: `${SHOTS}/same-user-detail-tab-a.png` });
  await tabB.screenshot({ path: `${SHOTS}/same-user-detail-tab-b.png` });

  await context.close();
});
