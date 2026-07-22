import { expect, type Page, test } from '@playwright/test';

const BASE = process.env['ORBIT_E2E_BASE_URL'] ?? 'http://localhost:3011';
const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'e2e-artifacts';

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
}

test('board, list, detail, comments and realtime', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await signIn(page, 'pulkit@noveum.ai');
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-board.png` });

  await page.keyboard.press('c');
  await expect(page.getByTestId('quick-create')).toBeVisible();
  const title = `Realtime smoke ${Date.now()}`;
  await page.getByTestId('quick-create-title').fill(title);
  await page.getByTestId('quick-create-submit').click();
  await expect(page.getByText(title)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-created.png` });

  await page.goto(`${BASE}/team/eng/issues`);
  await expect(page.getByTestId('issue-list')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-list.png` });

  await page.getByText(title).first().click();
  await expect(page.getByTestId('issue-detail')).toBeVisible();
  await page.getByTestId('comment-composer').fill('Looks good, shipping it.');
  await page.getByTestId('comment-submit').click();
  await expect(page.getByText('Looks good, shipping it.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-detail.png` });

  await context.close();
});
