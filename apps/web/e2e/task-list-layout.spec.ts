import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';
import { createIssue, descriptionOf, teamIdByKey } from './api.ts';
import { BASE } from './base-url.ts';

const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';

const CHECKLIST = [
  '# Done when',
  '',
  '- [ ] Establish what this actually means, or close it',
  '- [ ] If real: name the specific PRs and the review bar they have to clear',
  '',
  '---',
  '',
  'Migrated from NOVEU-295',
].join('\n');

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function setDescription(page: Page, id: string, description: string): Promise<void> {
  await page.evaluate(
    async ({ url, body }) => {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: body }),
      });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    },
    { url: `/api/issues/${id}`, body: description },
  );
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; height: number }> {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  if (found === null) throw new Error('the element never got a box');
  return { x: found.x, y: found.y, height: found.height };
}

async function expectBoxSitsOnItsFirstLine(item: Locator): Promise<void> {
  const checkbox = await boxOf(item.locator('input[type=checkbox]'));
  const text = await boxOf(item.locator('p').first());

  const checkboxCentre = checkbox.y + checkbox.height / 2;
  const firstLineCentre = text.y + Math.min(text.height, 28) / 2;

  expect(Math.abs(checkboxCentre - firstLineCentre)).toBeLessThan(8);
  expect(text.x).toBeGreaterThan(checkbox.x);
  expect(text.x - checkbox.x).toBeLessThan(48);
}

test('a task box shares its line with the task it belongs to', async ({ browser }) => {
  test.setTimeout(180_000);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await signIn(context, 'pulkit@noveum.ai');

  const teamId = await teamIdByKey(page, 'ENG');
  const issue = await createIssue(page, teamId, `E2E checklist ${Date.now() % 100000}`);
  await setDescription(page, issue.id, CHECKLIST);

  await page.goto(`${BASE}/issue/${issue.identifier}`);
  await expect(page.getByTestId('issue-detail')).toBeVisible();

  const items = page.getByTestId('issue-description').locator('li[data-checked]');
  await expect(items).toHaveCount(2);

  await expectBoxSitsOnItsFirstLine(items.first());
  await expectBoxSitsOnItsFirstLine(items.nth(1));

  const first = await boxOf(items.first());
  const second = await boxOf(items.nth(1));
  expect(second.y - first.y).toBeLessThan(60);

  const rule = await boxOf(page.getByTestId('issue-description').locator('hr').first());
  expect(rule.y - (second.y + second.height)).toBeLessThan(80);

  await page.screenshot({ path: `${SHOTS}/task-list-issue.png` });

  await items.first().locator('input[type=checkbox]').click();
  await expect(items.first()).toHaveAttribute('data-checked', 'true');
  await expect
    .poll(async () => await descriptionOf(page, issue.identifier), { timeout: 30_000 })
    .toContain('- [x] Establish what this actually means, or close it');

  await context.close();
});
