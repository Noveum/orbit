import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { createIssue, descriptionOf, teamIdByKey } from './api.ts';
import { BASE } from './base-url.ts';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('a screenshot dropped on an issue description is uploaded and shown inline', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/team/eng/board`);
  await page.waitForSelector('[data-testid^="issue-card-"]');
  const teamId = await teamIdByKey(page, 'ENG');
  const made = await createIssue(page, teamId, `Attach ${Date.now() % 100000}`);

  await page.goto(`${BASE}/issue/${made.identifier}`);
  const editor = page.getByTestId('issue-description');
  await expect(editor).toBeVisible();

  const transfer = await page.evaluateHandle((base64) => {
    const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([binary], 'screenshot.png', { type: 'image/png' }));
    return data;
  }, PNG_BASE64);
  await editor.dispatchEvent('drop', { dataTransfer: transfer });

  await expect(editor.locator('img')).toBeVisible({ timeout: 30_000 });
  const src = await editor.locator('img').first().getAttribute('src');
  expect(src ?? '').toContain('/api/files/');

  await expect
    .poll(async () => await descriptionOf(page, made.identifier), { timeout: 30_000 })
    .toContain('/api/files/');

  await page.reload();
  await expect(page.getByTestId('issue-description').locator('img')).toBeVisible({
    timeout: 30_000,
  });

  await context.close();
});

test('an html artifact attached to an issue renders in a sandboxed frame', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await signIn(context, 'alex@orbit.example');

  await page.goto(`${BASE}/team/eng/board`);
  await page.waitForSelector('[data-testid^="issue-card-"]');
  const teamId = await teamIdByKey(page, 'ENG');
  const made = await createIssue(page, teamId, `Artifact ${Date.now() % 100000}`);

  await page.goto(`${BASE}/issue/${made.identifier}`);
  const editor = page.getByTestId('issue-description');
  await expect(editor).toBeVisible();

  const transfer = await page.evaluateHandle(() => {
    const html = '<!doctype html><html><body><h1>Measured</h1></body></html>';
    const data = new DataTransfer();
    data.items.add(
      new File([new TextEncoder().encode(html)], 'artifact.html', { type: 'text/html' }),
    );
    return data;
  });
  await editor.dispatchEvent('drop', { dataTransfer: transfer });

  await expect
    .poll(async () => await descriptionOf(page, made.identifier), { timeout: 30_000 })
    .toContain('/api/files/');

  await page.reload();
  const frame = page.getByTestId('html-attachment-preview');
  await expect(frame).toBeVisible({ timeout: 60_000 });
  expect(await frame.getAttribute('src')).toContain('/api/attachments/html/');
  expect(await frame.getAttribute('sandbox')).not.toContain('allow-same-origin');

  await context.close();
});
