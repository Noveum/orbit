import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { createDoc, statusOf } from './api.ts';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('private access requires an invitation even for admins and revocation clears an open page', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const readerContext = await browser.newContext();
  const owner = await signIn(ownerContext, 'jordan@orbit.example');
  const reader = await signIn(readerContext, 'alex@orbit.example');
  const doc = await createDoc(owner, 'Private launch decisions', 'private');
  expect(await statusOf(reader, `/api/docs/${doc.id}`)).toBe(404);
  await owner.goto(`${BASE}/docs/${doc.id}`);
  await expect(owner.getByTestId('doc-share')).toHaveCount(1);
  await owner.getByTestId('doc-share').click();
  await owner.getByTestId('doc-access-search').fill('Alex');
  await owner.locator('[data-testid^="doc-access-add-"]').first().click();
  await expect(owner.locator('[data-testid^="doc-access-row-"]')).toHaveCount(1);
  await reader.goto(`${BASE}/docs/${doc.id}`);
  await expect(
    reader.getByRole('heading', { name: 'Private launch decisions', exact: true }),
  ).toBeVisible();
  await reader.getByTestId('doc-share').click();
  await expect(reader.getByTestId('doc-visibility-public')).toBeDisabled();
  await reader.keyboard.press('Escape');
  await owner.locator('[data-testid^="doc-access-remove-"]').first().click();
  await expect(owner.locator('[data-testid^="doc-access-row-"]')).toHaveCount(0);
  await expect(reader.getByTestId('doc-reader')).toHaveCount(0);
  expect(await statusOf(reader, `/api/docs/${doc.id}`)).toBe(404);
  await ownerContext.close();
  await readerContext.close();
});

test('folders, resized panes, writing, preview and published links work together', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'alex@orbit.example');
  await page.goto(`${BASE}/docs`);
  await expect(page.getByTestId('doc-group-toggle-private')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByTestId('doc-group-toggle-private').click();
  const sidebar = page.getByRole('separator', { name: 'Resize document sidebar' });
  await sidebar.press('ArrowRight');
  await expect(sidebar).toHaveAttribute('aria-valuenow', '272');
  await page.reload();
  await expect(sidebar).toHaveAttribute('aria-valuenow', '272');
  await expect(page.getByTestId('doc-group-toggle-private')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.goto(`${BASE}/docs/new`);
  await page.waitForURL((url) => url.pathname.startsWith('/docs/') && url.pathname !== '/docs/new');
  await page.getByTestId('doc-title-input').fill('Atlas launch handbook');
  await page.getByTestId('editor-mode-markdown').click();
  const source = page.getByTestId('doc-editor-input');
  await source.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    '## Launch checklist\n\n- [x] Review the design\n- [ ] Publish release notes\n\n## Working together\n\nUse comments to collect feedback.\n',
  );
  await expect(page.getByTestId('doc-save-status')).toHaveText('Saved');
  await page.getByTestId('toggle-preview').click();
  const divider = page.getByRole('separator', { name: 'Resize markdown and preview' });
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '48');
  await page.getByTestId('editor-mode-preview').click();
  await expect(
    page.getByTestId('doc-reading-preview').getByRole('heading', { name: 'Launch checklist' }),
  ).toBeVisible();
  await page.getByTestId('doc-share').click();
  await expect(page.getByTestId('doc-visibility-private')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('doc-visibility-link').click();
  const published = page.getByTestId('doc-copy-public-link-url');
  await expect(published).toBeVisible();
  const url = (await published.innerText()).trim();
  const anonymousContext = await browser.newContext();
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto(url);
  await expect(anonymous.getByTestId('published-doc')).toBeVisible();
  await expect(
    anonymous.getByRole('heading', { name: 'Atlas launch handbook', exact: true }),
  ).toBeVisible();
  await expect(anonymous.getByTestId('doc-editor')).toHaveCount(0);
  await page.getByTestId('doc-rotate-link').click();
  await expect(published).not.toHaveText(url);
  await anonymous.reload();
  await expect(anonymous.getByTestId('published-doc')).toHaveCount(0);
  await anonymousContext.close();
  await context.close();
});
