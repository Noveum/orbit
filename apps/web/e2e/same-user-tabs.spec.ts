import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { BASE } from './base-url.ts';

const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';
const PROPAGATION_TIMEOUT = 20_000;
const SUBSCRIPTION_TIMEOUT = 15_000;

const subscribedFrameSchema = z.object({
  type: z.literal('subscribed'),
  scopes: z.array(z.string()),
});

function teamSubscription(page: Page): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handleWebSocket = (socket: import('@playwright/test').WebSocket) => {
      socket.on('framereceived', ({ payload }) => {
        if (settled || typeof payload !== 'string') return;
        let value: unknown;
        try {
          value = JSON.parse(payload);
        } catch {
          return;
        }
        const parsed = subscribedFrameSchema.safeParse(value);
        if (!(parsed.success && parsed.data.scopes.some((scope) => scope.startsWith('team:')))) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        page.off('websocket', handleWebSocket);
        resolve();
      });
    };
    const timeout = setTimeout(() => {
      settled = true;
      page.off('websocket', handleWebSocket);
      reject(new Error('realtime did not subscribe to a team scope'));
    }, SUBSCRIPTION_TIMEOUT);
    page.on('websocket', handleWebSocket);
  });
}

async function openBoard(page: Page): Promise<void> {
  const subscribed = teamSubscription(page);
  await page.goto(`${BASE}/team/eng/board`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await subscribed;
}

async function openIssue(page: Page, identifier: string): Promise<void> {
  const subscribed = teamSubscription(page);
  await page.goto(`${BASE}/issue/${identifier}`);
  await expect(page.getByTestId('issue-detail')).toBeVisible();
  await subscribed;
}

test('one user in two tabs of the same browser sees issues, comments and reactions live', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });

  const tabA = await context.newPage();
  await tabA.goto(`${BASE}/login`);
  await tabA.getByTestId('dev-sign-in-alex@orbit.example').click();
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

  const card = tabA.locator('article[data-testid^="issue-card-"]', { hasText: title }).first();
  await expect(card).toBeVisible();
  const identifier = ((await card.getAttribute('data-testid')) ?? '').replace('issue-card-', '');
  expect(identifier).not.toBe('');

  await openIssue(tabA, identifier);
  await openIssue(tabB, identifier);

  const body = `Comment from the other tab ${Date.now() % 1000000}`;
  await tabA.getByTestId('comment-composer').locator('.ProseMirror').fill(body);
  await tabA.getByTestId('comment-composer-submit').click();
  await expect(tabA.getByText(body)).toBeVisible();

  await expect(tabB.getByText(body)).toBeVisible({ timeout: PROPAGATION_TIMEOUT });

  const posted = tabA.locator('article[data-testid^="comment-"]').last();
  await expect(posted).toBeVisible();
  const commentId = ((await posted.getAttribute('data-testid')) ?? '').replace('comment-', '');
  expect(commentId).not.toBe('');

  await tabA.getByTestId(`add-reaction-${commentId}`).click();
  await tabA.getByTestId('pick-reaction-🎉').click();
  await expect(tabA.getByTestId('reaction-🎉')).toBeVisible();

  await expect(tabB.getByTestId('reaction-🎉')).toBeVisible({ timeout: PROPAGATION_TIMEOUT });
  await tabA.screenshot({ path: `${SHOTS}/same-user-detail-tab-a.png` });
  await tabB.screenshot({ path: `${SHOTS}/same-user-detail-tab-b.png` });

  await context.close();
});
