import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';

const MARKDOWN = [
  '# Delta protocol',
  '',
  'Every mutation bumps `sync_id` and publishes a `SyncAction` to Redis.',
  '',
  '## Rules',
  '',
  '| Rule | Why |',
  '| --- | --- |',
  '| Batch inside 50ms | A bulk edit becomes one packet |',
  '| Filter by scope | A client never sees what it cannot read |',
  '',
  '## Checklist',
  '',
  '- [x] Fan out from Redis',
  '- [ ] Suppress the local echo',
  '',
  '```ts',
  'const action = { model: "doc", action: "update" };',
  '```',
  '',
].join('\n');

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAOklEQVRoge3OMQEAAAjAILV/aM3g4QcFaEnZzcysbwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwtwXbFwGvJP0JuwAAAABJRU5ErkJggg==';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` });
  await page.getByLabel('Toggle theme').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await page.getByLabel('Toggle theme').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
}

async function openNewDoc(page: Page, click: () => Promise<void>): Promise<void> {
  const from = new URL(page.url()).pathname;
  await click();
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/docs/') &&
      url.pathname !== from &&
      url.searchParams.get('edit') === '1',
  );
  await expect(page.getByTestId('doc-editor')).toBeVisible();
}

async function dropFiles(page: Page): Promise<void> {
  const transfer = await page.evaluateHandle((base64) => {
    const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([binary], 'delta-diagram.png', { type: 'image/png' }));
    data.items.add(
      new File([new TextEncoder().encode('%PDF-1.4 delta protocol')], 'delta-protocol.pdf', {
        type: 'application/pdf',
      }),
    );
    data.items.add(
      new File([new TextEncoder().encode('RIFF....WAVEfmt ')], 'standup.wav', {
        type: 'audio/wav',
      }),
    );
    data.items.add(
      new File([new TextEncoder().encode('....ftypisom')], 'walkthrough.mp4', {
        type: 'video/mp4',
      }),
    );
    return data;
  }, PNG_BASE64);
  await page.getByTestId('doc-editor-input').dispatchEvent('drop', { dataTransfer: transfer });
}

test('a doc is written, attached to, published, and read without a session', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const workspace = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const author = await signIn(workspace, 'pulkit@noveum.ai');

  await author.goto(`${BASE}/docs`);
  await expect(author.getByTestId('docs-workspace')).toBeVisible();
  await expect(author.getByText('Realtime delta protocol')).toBeVisible();
  await expect(author.getByTestId('docs-workspace').getByText('Engineering')).toBeVisible();
  await expect(author.getByTestId('docs-workspace').getByText('Project docs')).toBeVisible();
  await expect(author.getByTestId('docs-workspace').getByText('Private')).toBeVisible();

  await author.getByText('Realtime delta protocol').click();
  await expect(author.getByTestId('doc-reader')).toBeVisible();
  await expect(author.getByTestId('doc-repo-pill')).toContainText('docs/realtime.md');
  await expect(author.getByTestId('doc-reader').locator('th', { hasText: 'Rule' })).toBeVisible();
  await shoot(author, 'docs-browser');

  await author.getByTestId('doc-search').fill('checklist');
  await expect(author.getByText('Sync engine launch plan')).toBeVisible();
  await expect(author.getByText('Keyboard shortcuts')).toHaveCount(0);
  await author.getByTestId('doc-search').fill('');
  await expect(author.getByText('Keyboard shortcuts')).toBeVisible();

  const filedTitle = `Filed doc ${Date.now() % 100000}`;
  await openNewDoc(author, () => author.getByLabel('New doc in Engineering').click());
  await author.getByTestId('doc-title-input').fill(filedTitle);
  await expect(author.getByTestId('doc-save-status')).toHaveText('Saved', { timeout: 30_000 });
  await expect(
    author
      .getByTestId('docs-workspace')
      .locator('section')
      .filter({ hasText: 'Engineering' })
      .getByText(filedTitle),
  ).toBeVisible({ timeout: 30_000 });

  const title = `E2E doc ${Date.now() % 100000}`;
  await openNewDoc(author, () => author.getByTestId('new-doc').click());

  await author.getByTestId('doc-title-input').fill(title);
  await author.getByTestId('doc-editor-input').fill(MARKDOWN);
  await expect(author.getByTestId('doc-save-status')).toHaveText('Saved', { timeout: 30_000 });

  await author.getByTestId('toggle-preview').click();
  const preview = author.getByTestId('doc-body').last();
  await expect(preview.locator('th', { hasText: 'Rule' })).toBeVisible();
  await expect(preview.locator('input[type=checkbox]')).toHaveCount(2);
  await shoot(author, 'docs-editor');

  await dropFiles(author);
  await expect(author.getByTestId('doc-editor-input')).toHaveValue(
    /!\[delta-diagram\.png\]\(\/api\/files\//,
    { timeout: 30_000 },
  );
  await expect(author.getByTestId('doc-editor-input')).toHaveValue(
    /\[delta-protocol\.pdf\]\(\/api\/files\//,
    { timeout: 30_000 },
  );
  await expect(author.getByTestId('doc-save-status')).toHaveText('Saved', { timeout: 30_000 });

  await author.getByTestId('doc-edit-toggle').click();
  await expect(author.getByTestId('doc-reader')).toBeVisible();
  await expect(author.getByTestId('doc-reader').locator('th', { hasText: 'Rule' })).toBeVisible();
  await expect(author.getByTestId('doc-outline')).toBeVisible();
  await expect(author.getByTestId('doc-attachments')).toBeVisible();
  await shoot(author, 'docs-reader');

  await author.getByTestId('doc-attachments').scrollIntoViewIfNeeded();
  await expect(author.getByTestId('doc-attachments').locator('img')).toBeVisible();
  await expect(
    author.getByTestId('doc-attachments').getByText('PDF', { exact: true }),
  ).toBeVisible();
  await expect(author.getByTestId('doc-attachments').getByText('delta-protocol.pdf')).toBeVisible();
  await expect(author.getByTestId('doc-attachments').locator('audio')).toHaveCount(1);
  await expect(author.getByTestId('doc-attachments').locator('video')).toHaveCount(1);
  await shoot(author, 'docs-attachment');

  const watching = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const watcher = await signIn(watching, 'shashank@noveum.ai');
  await watcher.goto(`${BASE}${new URL(author.url()).pathname}`);
  await expect(watcher.getByTestId('doc-reader')).toBeVisible();
  await expect(watcher.getByRole('heading', { level: 1, name: title })).toBeVisible();

  const renamed = `${title} renamed`;
  await author.getByTestId('doc-edit-toggle').click();
  await author.getByTestId('doc-title-input').fill(renamed);
  await expect(author.getByTestId('doc-save-status')).toHaveText('Saved', { timeout: 30_000 });
  await expect(watcher.getByRole('heading', { level: 1, name: renamed })).toBeVisible({
    timeout: 30_000,
  });
  await watching.close();

  await author.getByTestId('doc-edit-toggle').click();
  await expect(author.getByTestId('doc-reader')).toBeVisible();

  await author.getByTestId('doc-publish').click();
  await expect(author.getByTestId('doc-publish')).toHaveText('Unpublish', { timeout: 30_000 });
  await author.getByTestId('doc-share').click();
  const link = author.getByTestId('doc-copy-link');
  await expect(link).toBeVisible();
  const publishedUrl = ((await link.textContent()) ?? '').trim();
  expect(publishedUrl).toContain('/d/');
  await author.keyboard.press('Escape');

  for (const scheme of ['light', 'dark'] as const) {
    const anonymous = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    const visitor = await anonymous.newPage();
    await visitor.goto(publishedUrl);
    await expect(visitor.getByTestId('published-doc')).toBeVisible();
    await expect(visitor.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(visitor.locator('th', { hasText: 'Rule' })).toBeVisible();
    await expect(visitor.locator('input[type=checkbox]')).toHaveCount(2);
    await expect(visitor.getByTestId('doc-attachments')).toBeVisible();
    await expect(visitor.getByTestId('doc-editor')).toHaveCount(0);
    await expect(visitor.getByTestId('doc-edit-toggle')).toHaveCount(0);
    await expect(visitor.getByTestId('doc-search')).toHaveCount(0);
    await visitor.screenshot({ path: `${SHOTS}/docs-published-${scheme}.png` });
    await anonymous.close();
  }

  await author.getByTestId('doc-share').click();
  await author.getByTestId('doc-visibility-workspace').click();
  await expect(author.getByTestId('doc-publish')).toHaveText('Publish', { timeout: 30_000 });

  const revoked = await browser.newContext();
  const revokedPage = await revoked.newPage();
  const response = await revokedPage.goto(publishedUrl);
  expect(response?.status()).toBe(404);
  await revoked.close();

  await workspace.close();
});
