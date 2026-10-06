import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { teamIdByKey } from './api.ts';
import { BASE } from './base-url.ts';

const PHONE = { width: 390, height: 780 };
const DESKTOP = { width: 1440, height: 900 };

const FIRST_PARAGRAPH = 'Paragraph 0 of a description taller than any phone viewport.';

const LONG_DESCRIPTION = Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${index} of a description taller than any phone viewport.`,
).join('\n\n');

const issueEnvelopeSchema = z.object({
  issue: z.object({ id: z.string().min(1), identifier: z.string().min(1) }),
});

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function createDescribedIssue(
  page: Page,
  teamId: string,
  title: string,
): Promise<{ id: string; identifier: string }> {
  const body = await page.evaluate(
    async ({ team, name, description }) => {
      const response = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: team, title: name, description }),
      });
      if (!response.ok) throw new Error(`/api/issues answered ${response.status}`);
      return (await response.json()) as unknown;
    },
    { team: teamId, name: title, description: LONG_DESCRIPTION },
  );
  return issueEnvelopeSchema.parse(body).issue;
}

interface Panes {
  readonly mainClientHeight: number;
  readonly mainScrollHeight: number;
  readonly mainOverflowY: string;
  readonly rootScrolls: boolean;
}

async function panesOf(page: Page, within: string): Promise<Panes> {
  return await page.evaluate((selector) => {
    const root = document.querySelector(`${selector} [data-testid=issue-detail]`);
    if (root === null) throw new Error(`no issue detail inside ${selector}`);
    const main = root.querySelector('[data-testid=issue-detail-main]');
    if (main === null) throw new Error('the issue detail rendered no main column');
    return {
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      mainOverflowY: getComputedStyle(main).overflowY,
      rootScrolls: root.scrollHeight > root.clientHeight,
    };
  }, within);
}

test('the issue body is readable on a phone rather than clipped to nothing', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await signIn(context, 'alex@orbit.example');

  const teamId = await teamIdByKey(page, 'ENG');
  const issue = await createDescribedIssue(page, teamId, 'An issue read on a phone');

  await page.goto(`${BASE}/issue/${issue.identifier}`);
  await expect(page.getByTestId('issue-detail')).toBeVisible();
  await expect(page.getByTestId('issue-title')).toHaveValue('An issue read on a phone');
  await expect(page.getByText(FIRST_PARAGRAPH)).toBeVisible();

  const panes = await panesOf(page, 'body');
  expect(panes.mainClientHeight, 'the main column collapsed').toBeGreaterThan(0);
  expect(panes.mainClientHeight, 'the main column clipped its own content').toBe(
    panes.mainScrollHeight,
  );
  expect(panes.rootScrolls, 'stacked layout gave the reader nothing to scroll').toBe(true);

  await context.close();
});

test('the peek panel shows the issue body on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await signIn(context, 'alex@orbit.example');

  const teamId = await teamIdByKey(page, 'ENG');
  const issue = await createDescribedIssue(page, teamId, 'An issue peeked on a phone');

  await page.goto(`${BASE}/team/eng/issues`);
  const row = page.getByTestId(`issue-row-${issue.identifier}`);
  await expect(row).toBeVisible();
  await row.getByRole('link').first().click();

  const peek = page.getByTestId('issue-peek');
  await expect(peek).toHaveAttribute('aria-label', `Peek ${issue.identifier}`);
  await expect(peek.getByText(FIRST_PARAGRAPH)).toBeVisible();

  const panes = await panesOf(page, '[data-testid=issue-peek]');
  expect(panes.mainClientHeight, 'the peek main column collapsed').toBeGreaterThan(0);
  expect(panes.mainClientHeight, 'the peek clipped its own content').toBe(panes.mainScrollHeight);

  await context.close();
});

test('the desktop layout still scrolls inside the main column', async ({ browser }) => {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await signIn(context, 'alex@orbit.example');

  const teamId = await teamIdByKey(page, 'ENG');
  const issue = await createDescribedIssue(page, teamId, 'An issue read on a desktop');

  await page.goto(`${BASE}/issue/${issue.identifier}`);
  await expect(page.getByTestId('issue-detail')).toBeVisible();

  const panes = await panesOf(page, 'body');
  expect(panes.mainOverflowY, 'the main column stopped owning its scroll').toBe('auto');
  expect(panes.mainScrollHeight, 'the main column stopped scrolling').toBeGreaterThan(
    panes.mainClientHeight,
  );
  expect(panes.rootScrolls, 'the row layout grew a second scrollbar').toBe(false);

  await context.close();
});
