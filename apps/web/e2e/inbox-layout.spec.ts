import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { createIssue, teamIdByKey } from './api.ts';
import { BASE } from './base-url.ts';

const WIDE_COMMENT = [
  'The shared packages diverged, so the patch below has to be applied by hand.',
  '',
  '```diff',
  '--- a/packages/rbac/src/permissions.ts',
  '+++ b/packages/rbac/src/permissions.ts',
  '+  { service: "autofix", action: "write", description: "Create or update AutoFix runs and approve or reject a proposed patch" },',
  '+  { service: "autofix", action: "execute", description: "Run and cancel AutoFix backtests against a recorded incident window" },',
  '```',
  '',
  `An unbroken token no soft wrap can help with: ${'a'.repeat(180)}`,
].join('\n');

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function comment(page: Page, issueId: string, body: string): Promise<void> {
  await page.evaluate(
    async ({ url, text }) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: text, parentId: null }),
      });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    },
    { url: `/api/comments?issueId=${encodeURIComponent(issueId)}`, text: body },
  );
}

interface Overflow {
  readonly documentY: number;
  readonly mainY: number;
  readonly mainX: number;
}

async function overflowOf(page: Page): Promise<Overflow> {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector('main');
    if (main === null) throw new Error('the shell never rendered a main');
    return {
      documentY: root.scrollHeight - root.clientHeight,
      mainY: main.scrollHeight - main.clientHeight,
      mainX: main.scrollWidth - main.clientWidth,
    };
  });
}

test('the inbox fills the shell without inventing scroll of its own', async ({ browser }) => {
  const reading = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const writing = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reader = await signIn(reading, 'sam@orbit.example');
  const author = await signIn(writing, 'alex@orbit.example');

  const teamId = await teamIdByKey(reader, 'ENG');
  const watched = await createIssue(reader, teamId, 'An issue whose comments the reader follows');
  await comment(author, watched.id, WIDE_COMMENT);

  await reader.goto(`${BASE}/inbox`);
  await expect(reader.getByTestId('inbox-detail')).toBeVisible();

  const settled = await overflowOf(reader);
  expect(settled.documentY).toBe(0);
  expect(settled.mainY).toBe(0);
  expect(settled.mainX).toBe(0);

  await reading.close();
  await writing.close();
});

test('a list longer than the pane never pushes the shell off the page', async ({ browser }) => {
  const reading = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const writing = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reader = await signIn(reading, 'sam@orbit.example');
  const author = await signIn(writing, 'alex@orbit.example');

  const teamId = await teamIdByKey(reader, 'ENG');
  for (let index = 0; index < 18; index += 1) {
    const issue = await createIssue(reader, teamId, `A followed issue number ${index}`);
    await comment(author, issue.id, `Reply number ${index}`);
  }

  await reader.goto(`${BASE}/inbox`);
  await expect(reader.getByTestId('inbox-detail')).toBeVisible();

  const list = reader.locator('main ul').first();
  await expect
    .poll(async () => await list.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(0);

  for (const tab of ['All', 'Unread', 'Mentions', 'Pull requests']) {
    await reader.getByRole('button', { name: tab, exact: true }).click();
    const measured = await overflowOf(reader);
    expect(measured.documentY, `${tab} pushed the document`).toBe(0);
    expect(measured.mainY, `${tab} left dead space under the shell`).toBe(0);
    expect(measured.mainX, `${tab} pushed the shell sideways`).toBe(0);
  }

  await reading.close();
  await writing.close();
});

test('a code block scrolls inside itself rather than widening the pane', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const author = await signIn(context, 'alex@orbit.example');

  const teamId = await teamIdByKey(author, 'ENG');
  const issue = await createIssue(author, teamId, 'A comment carrying a wide diff');
  await comment(author, issue.id, WIDE_COMMENT);

  await author.goto(`${BASE}/issue/${issue.identifier}`);
  const block = author.locator('[data-testid=comment-thread] pre').first();
  await expect(block).toBeVisible();

  const contained = await block.evaluate((node) => ({
    scrolls: node.scrollWidth > node.clientWidth,
    overflowX: getComputedStyle(node).overflowX,
    withinParent:
      node.getBoundingClientRect().width <=
      (node.parentElement?.getBoundingClientRect().width ?? 0) + 1,
  }));
  expect(contained.overflowX).toBe('auto');
  expect(contained.withinParent).toBe(true);

  expect((await overflowOf(author)).mainX).toBe(0);

  await context.close();
});
