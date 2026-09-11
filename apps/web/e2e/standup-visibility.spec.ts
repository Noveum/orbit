import { expect, test } from '@playwright/test';
import { bootstrapSchema, issueListSchema, issueSummarySchema } from '../src/lib/query/schemas.ts';
import { BASE } from './base-url.ts';

test('Standup shows a member tasks from other teams and filters by participant', async ({
  page,
}, testInfo) => {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-taylor@orbit.example').click();
  await page.waitForURL(`${BASE}/my-issues`);
  await page.goto(`${BASE}/standup`);
  await expect(page.getByRole('heading', { name: 'Standup', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All tasks', exact: true })).toHaveCount(0);
  const bootstrap = bootstrapSchema.parse(
    await (await page.request.get(`${BASE}/api/bootstrap`)).json(),
  );
  const ordinary = issueListSchema.parse(
    await (await page.request.get(`${BASE}/api/issues?limit=100`)).json(),
  );
  expect(
    ordinary.issues.every((issue) => bootstrap.teams.some((team) => team.id === issue.teamId)),
  ).toBe(true);
  const response = await page.request.get(`${BASE}/api/issues?view=standup&limit=100`);
  expect(response.ok()).toBe(true);
  const { issues } = issueListSchema.parse(await response.json());
  const external = issues.find(
    (issue) =>
      issue.identifier.startsWith('ENG-') &&
      issue.canOpen === false &&
      issue.assigneeId !== null &&
      issue.completedAt === null &&
      issue.canceledAt === null &&
      issue.parentId === null,
  );
  if (external === undefined)
    throw new Error('Expected an active Engineering task assigned to a person.');
  const card = page.getByTestId(`issue-card-${external.identifier}`);
  await expect(card).toBeVisible();
  await expect(card.getByRole('link')).toHaveCount(0);
  expect((await page.request.get(`${BASE}/api/issues/${external.identifier}`)).status()).toBe(404);
  const summary = issueSummarySchema.parse(
    await (
      await page.request.get(`${BASE}/api/issues/summary?view=standup&groupBy=participant`)
    ).json(),
  );
  const person = external.assigneeId;
  if (person === null) throw new Error('Expected an assignee.');
  await expect(page.getByTestId(`standup-tile-count-${person}`)).toHaveText(
    String(summary.groupTotals[person]),
  );
  await page.getByTestId(`standup-tile-${person}`).click();
  await expect(page).toHaveURL(new RegExp(`person=${person}`));
  await expect(card).toBeVisible();
  const selected = issueListSchema.parse(
    await (
      await page.request.get(`${BASE}/api/issues?view=standup&participantId=${person}&limit=100`)
    ).json(),
  );
  expect(selected.issues.length).toBeGreaterThan(0);
  expect(
    selected.issues.every(
      (issue) => issue.assigneeId === person || issue.reviewerIds?.includes(person),
    ),
  ).toBe(true);
  const selectedCards = new Set(selected.issues.map((issue) => `issue-card-${issue.identifier}`));
  await expect
    .poll(async () => {
      const rendered = await page
        .locator('[data-testid^="issue-card-"]')
        .evaluateAll((cards) => cards.map((item) => item.getAttribute('data-testid')));
      return rendered.length > 0 && rendered.every((id) => id !== null && selectedCards.has(id));
    })
    .toBe(true);
  await page.getByTestId('standup-tile-everyone').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(theme);
    }, theme);
    await page.screenshot({
      path: testInfo.outputPath(`standup-visibility-${theme}.png`),
      fullPage: true,
      style: 'nextjs-portal { display: none; }',
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Standup', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
