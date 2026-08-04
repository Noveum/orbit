import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('a private doc can be shared with a named person, who can then open it', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const owner = await signIn(ownerContext, 'pulkit@noveum.ai');

  const created = await owner.evaluate(async () => {
    const response = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Compensation review',
        content: 'Numbers.',
        visibility: 'private',
      }),
    });
    return (await response.json()) as { doc?: { id: string } };
  });
  const docId = created.doc?.id;
  if (docId === undefined) throw new Error('the doc was not created');

  const readerContext = await browser.newContext();
  const reader = await signIn(readerContext, 'aditi@noveum.ai');
  const before = await reader.evaluate(
    async (id) => (await fetch(`/api/docs/${id}`)).status,
    docId,
  );
  expect(before).toBe(404);

  await owner.goto(`${BASE}/docs/${docId}`);
  await owner.getByTestId('doc-publish').click();
  await owner.getByTestId('doc-open-people').click();
  await expect(owner.getByTestId('doc-people-access')).toBeVisible();

  await owner.getByTestId('doc-access-search').fill('Aditi');
  const candidate = owner.locator('[data-testid^="doc-access-add-"]').first();
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(owner.locator('[data-testid^="doc-access-row-"]')).toHaveCount(1);

  const after = await reader.evaluate(async (id) => (await fetch(`/api/docs/${id}`)).status, docId);
  expect(after).toBe(200);

  const level = owner.locator('[data-testid^="doc-access-level-"]').first();
  await expect(level).toHaveText('Can view');
  await level.click();
  await expect(level).toHaveText('Can edit');

  await ownerContext.close();
  await readerContext.close();
});
