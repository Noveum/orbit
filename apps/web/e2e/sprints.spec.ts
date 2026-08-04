import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

test('a sprint can be opened and closed, and its outcome survives the rollover', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await signIn(context, 'pulkit@noveum.ai');

  await page.goto(`${BASE}/sprints`);
  await expect(page.getByRole('heading', { name: 'Sprints', level: 1 })).toBeVisible();

  const teamId = await page.evaluate(async () => {
    const response = await fetch('/api/bootstrap');
    const body = (await response.json()) as { teams?: { key: string; id: string }[] };
    return body.teams?.find((team) => team.key === 'ENG')?.id ?? null;
  });
  expect(teamId).not.toBeNull();

  const label = `Regression sprint ${Date.now()}`;
  const created = await page.evaluate(
    async ({ id, name }) => {
      const response = await fetch('/api/cycles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teamId: id,
          name,
          startsAt: '2033-04-03T00:00:00.000Z',
          endsAt: '2033-04-17T00:00:00.000Z',
        }),
      });
      return (await response.json()) as { cycle?: { id: string; number: number } };
    },
    { id: teamId, name: label },
  );
  const sprint = created.cycle;
  if (sprint === undefined) throw new Error('the sprint was not created');

  const closed = await page.evaluate(async (id) => {
    const response = await fetch(`/api/cycles/${id}/complete`, { method: 'POST' });
    return { status: response.status, body: await response.json() };
  }, sprint.id);
  expect(closed.status).toBe(200);

  await page.goto(`${BASE}/sprints`);
  const engPanels = page.getByTestId(`sprint-history-eng-${sprint.number}`);
  await expect(engPanels).toHaveCount(1);
  const entry = engPanels.first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(label);

  await entry.click();
  await expect(page).toHaveURL(`${BASE}/team/eng/sprint/${sprint.number}`);
  await expect(page.getByTestId('sprint-outcome')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(label);

  await context.close();
});

test('the old cycle urls still land on the sprint pages', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, 'pulkit@noveum.ai');

  await page.goto(`${BASE}/cycles`);
  await expect(page).toHaveURL(`${BASE}/sprints`);

  await page.goto(`${BASE}/team/eng/cycle/active`);
  await expect(page).toHaveURL(`${BASE}/team/eng/sprint/active`);

  await context.close();
});
