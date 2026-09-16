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

test('a private doc can be shared with a named person, who can then open it', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const owner = await signIn(ownerContext, 'alex@orbit.example');

  const doc = await createDoc(owner, 'Compensation review', 'private');
  const docId = doc.id;

  const readerContext = await browser.newContext();
  const reader = await signIn(readerContext, 'jordan@orbit.example');
  expect(await statusOf(reader, `/api/docs/${docId}`)).toBe(404);

  await owner.goto(`${BASE}/docs/${docId}`);
  await owner.getByTestId('doc-share').click();
  await expect(owner.getByTestId('doc-people-access')).toBeVisible();

  await owner.getByTestId('doc-access-search').fill('Jordan');
  const candidate = owner.locator('[data-testid^="doc-access-add-"]').first();
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(owner.locator('[data-testid^="doc-access-row-"]')).toHaveCount(1);

  expect(await statusOf(reader, `/api/docs/${docId}`)).toBe(200);

  const level = owner.locator('[data-testid^="doc-access-level-"]').first();
  await expect(level).toHaveText('Can view');
  await level.click();
  await expect(level).toHaveText('Can edit');

  await ownerContext.close();
  await readerContext.close();
});

test('an html page carries an artifact link the workspace can open and outsiders cannot', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const owner = await signIn(ownerContext, 'alex@orbit.example');

  const doc = await createDoc(owner, 'Build record', 'workspace', {
    kind: 'html',
    content: '<!doctype html><title>Build record</title><p>Everything is green</p>',
  });

  await owner.goto(`${BASE}/docs/${doc.id}`);
  await owner.getByTestId('doc-share').click();
  const link = owner.getByTestId('doc-copy-artifact-link-url');
  await expect(link).toContainText(`/docs/${doc.id}/artifact`);
  const artifactUrl = ((await link.textContent()) ?? '').trim();
  await owner.keyboard.press('Escape');

  const readerContext = await browser.newContext();
  const reader = await signIn(readerContext, 'jordan@orbit.example');
  expect(await statusOf(reader, `/docs/${doc.id}/artifact`)).toBe(200);
  await reader.goto(artifactUrl);
  await expect(reader.getByText('Everything is green')).toBeVisible();

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto(artifactUrl);
  await expect(stranger).toHaveURL(/\/login/);
  await expect(stranger.getByText('Everything is green')).toHaveCount(0);

  await ownerContext.close();
  await readerContext.close();
  await strangerContext.close();
});
