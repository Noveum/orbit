import { workspaceTasksPageSchema } from '@orbit/shared/validators';
import { expect, test } from '@playwright/test';
import { BASE } from './base-url.ts';

test('a member sees other teams in All tasks and can search and filter them', async ({
  page,
}, testInfo) => {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-taylor@orbit.example').click();
  await page.waitForURL(`${BASE}/my-issues`);
  await page.getByRole('link', { name: 'All tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible();
  const response = await page.request.get(`${BASE}/api/workspace-tasks`);
  expect(response.ok()).toBe(true);
  const { tasks } = workspaceTasksPageSchema.parse(await response.json());
  const external = tasks.find((task) => task.team === 'Engineering');
  if (external === undefined)
    throw new Error('Expected an Engineering task in the seeded workspace.');
  expect(external.canOpen).toBe(false);
  const table = page.getByRole('table', { name: 'All tasks' });
  await expect(table.getByRole('row').filter({ hasText: external.title })).toBeVisible();
  await expect(table.getByRole('link', { name: new RegExp(external.identifier) })).toHaveCount(0);
  await expect(table.getByRole('link').first()).toBeVisible();
  expect((await page.request.get(`${BASE}/api/issues/${external.identifier}`)).status()).toBe(404);
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });
  await page.screenshot({
    path: testInfo.outputPath('all-tasks-light.png'),
    fullPage: true,
    style: 'nextjs-portal { display: none; }',
  });
  await page.evaluate(() => {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  });
  await page.screenshot({
    path: testInfo.outputPath('all-tasks-dark.png'),
    fullPage: true,
    style: 'nextjs-portal { display: none; }',
  });
  await page.getByRole('textbox', { name: 'Search tasks' }).fill(external.identifier);
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.getByRole('row').filter({ hasText: external.title })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search tasks' }).fill('no-task-matches-this-search');
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No matching tasks.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search tasks' }).fill('');
  await page.getByRole('main').getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter by assignee' }).click();
  await page.getByRole('option', { name: 'Jordan Lee', exact: true }).click();
  await expect(table.locator('tbody tr').first()).toBeVisible();
  for (const row of await table.locator('tbody tr').all()) {
    await expect(row.getByRole('cell', { name: 'Jordan Lee', exact: true })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Filter by status' }).click();
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Filter by status' })).toContainText('Completed');
  const completed = tasks.filter((task) => task.assignee === 'Jordan Lee' && task.state === 'Done');
  expect(completed.length).toBeGreaterThan(0);
  await expect(table.locator('tbody tr')).toHaveCount(completed.length);
  for (const row of await table.locator('tbody tr').all()) {
    await expect(row.getByRole('cell', { name: 'Done', exact: true })).toBeVisible();
  }
  expect((await page.request.get(`${BASE}/api/workspace-tasks?limit=201`)).status()).toBe(422);
  await page.getByRole('checkbox', { name: 'Include archived' }).check();
  await expect(page.getByRole('checkbox', { name: 'Include archived' })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
