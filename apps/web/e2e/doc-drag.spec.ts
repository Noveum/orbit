import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function dragTo(page: Page, from: string, to: string): Promise<void> {
  const source = page.getByTestId(from);
  const target = page.getByTestId(to);
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  if (start === null || end === null) throw new Error('the row or the folder has no box');

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      start.x + (end.x + end.width / 2 - start.x) * (step / steps),
      start.y + (end.y + end.height / 2 - start.y) * (step / steps),
    );
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
}

async function folderHolding(page: Page, docId: string): Promise<string | null> {
  return await page.evaluate((id) => {
    const row = document.querySelector(`[data-testid="doc-row-wrap-${id}"]`);
    const folder = row?.closest('[data-testid^="doc-folder-"]') ?? null;
    return folder?.getAttribute('data-testid') ?? null;
  }, docId);
}

test('a doc dragged onto a folder is filed there and stays after a reload', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/docs`);
  await expect(page.getByTestId('doc-tree')).toBeVisible();

  const folderName = `Filed ${Date.now()}`;
  await page.getByTestId('new-collection').click();
  await page.getByTestId('new-collection-name').fill(folderName);
  await page.keyboard.press('Enter');

  const folder = page.locator('[data-testid^="doc-folder-"]').filter({ hasText: folderName });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  const folderTestId = await folder.getAttribute('data-testid');
  if (folderTestId === null) throw new Error('the new folder has no test id');
  const folderId = folderTestId.replace('doc-folder-', '');

  const loose = page.locator(`[data-testid^="doc-row-wrap-"]`);
  await expect(loose.first()).toBeVisible({ timeout: 15_000 });
  const wrapTestId = await loose.first().getAttribute('data-testid');
  if (wrapTestId === null) throw new Error('the tree holds no doc');
  const docId = wrapTestId.replace('doc-row-wrap-', '');
  const startedIn = await folderHolding(page, docId);
  expect(startedIn).not.toBe(folderTestId);

  await dragTo(page, `doc-row-wrap-${docId}`, `doc-group-toggle-${folderId}`);

  await expect
    .poll(async () => await folderHolding(page, docId), { timeout: 20_000 })
    .toBe(folderTestId);

  await page.reload();
  await expect(page.getByTestId('doc-tree')).toBeVisible();
  await expect
    .poll(async () => await folderHolding(page, docId), { timeout: 30_000 })
    .toBe(folderTestId);

  await context.close();
});

test('a private doc offers a link that can be copied and handed to a colleague', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/docs`);
  const firstDoc = page.locator('[data-testid^="doc-row-"]:not([data-testid$="-menu"])').first();
  await expect(firstDoc).toBeVisible({ timeout: 15_000 });
  await firstDoc.click();

  await page.getByTestId('doc-share').click();
  await page.getByTestId('doc-visibility-private').click();

  const copy = page.getByTestId('doc-copy-link');
  await expect(copy).toBeVisible();
  await copy.click();

  const copied = await page.evaluate(async () => await navigator.clipboard.readText());
  expect(copied).toContain('/docs/');

  await context.close();
});
