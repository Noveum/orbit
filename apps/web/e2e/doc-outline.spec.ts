import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('an editable doc still has a table of contents that navigates it', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1700, height: 900 } });
  const page = await signIn(context, 'pulkit@noveum.ai');

  await page.goto(`${BASE}/docs`);
  await page.getByTestId('doc-tree').getByText('Realtime delta protocol').click();

  await expect(page.getByTestId('doc-rich-editor')).toBeVisible();

  const outline = page.getByTestId('doc-outline');
  await expect(outline).toBeVisible();
  await expect(outline.locator('a')).toHaveText([
    'Realtime delta protocol',
    'Action shape',
    'Rules',
  ]);

  await outline.locator('a', { hasText: 'Rules' }).first().click();
  await expect(outline.locator('[aria-current="location"]')).toHaveText('Rules');

  await page.getByTestId('editor-mode-markdown').click();
  await expect(page.getByTestId('doc-editor-input')).toBeVisible();

  await expect(outline.locator('a')).toHaveText([
    'Realtime delta protocol',
    'Action shape',
    'Rules',
  ]);
  await outline.locator('a', { hasText: 'Rules' }).first().click();
  await expect(page.getByTestId('doc-editor-input')).toBeFocused();

  await context.close();
});
