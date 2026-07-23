import { expect, test } from '@playwright/test';

const BASE = process.env['ORBIT_E2E_BASE_URL'] ?? 'http://localhost:3011';
const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';

test.use({ viewport: { width: 1440, height: 900 } });

test('filters narrow the list, round trip through the url and save as a view', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-pulkit@noveum.ai').click();
  await page.waitForURL(`${BASE}/my-issues`);

  await page.goto(`${BASE}/team/eng/issues`);
  await expect(page.getByTestId('issue-list')).toBeVisible();
  const total = Number(await page.getByTestId('issue-count').innerText());
  expect(total).toBeGreaterThan(0);

  await page.keyboard.press('f');
  await expect(page.getByTestId('filter-menu')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/filter-menu.png` });

  await page.getByTestId('filter-field-assignee').click();
  const options = page.locator('[data-testid^="filter-value-"]');
  const optionCount = await options.count();

  let filtered = 0;
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    await option.click();
    await expect
      .poll(async () => Number(await page.getByTestId('issue-count').innerText()))
      .toBeLessThan(total);
    filtered = Number(await page.getByTestId('issue-count').innerText());
    if (filtered > 0) break;
    await option.click();
    await expect.poll(async () => page.url()).not.toContain('filter=assignee');
  }

  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('filter-chip-assignee')).toBeVisible();
  await expect(page).toHaveURL(/filter=assignee%3Ais%3A/);
  const rendered = await page.locator('[data-testid^="issue-row-"]').count();
  expect(rendered).toBeLessThanOrEqual(filtered);

  await page.keyboard.press('f');
  await page.getByTestId('filter-field-priority').click();
  await page.getByTestId('filter-value-1').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-chip-priority')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/filter-chips.png` });

  await expect
    .poll(async () => Number(await page.getByTestId('issue-count').innerText()))
    .toBeLessThanOrEqual(filtered);
  const twoFilters = Number(await page.getByTestId('issue-count').innerText());

  const filteredUrl = page.url();
  await page.reload();
  await expect(page.getByTestId('filter-chip-assignee')).toBeVisible();
  await expect(page.getByTestId('filter-chip-priority')).toBeVisible();
  expect(Number(await page.getByTestId('issue-count').innerText())).toBe(twoFilters);

  await page.getByTestId('display-menu-trigger').click();
  await expect(page.getByTestId('display-menu')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/display-menu.png` });
  await page.getByTestId('group-by-priority').click();
  await expect(page).toHaveURL(/group=priority/);

  await page.goto(filteredUrl);
  await page.getByTestId('save-view').click();
  const name = `E2E view ${Date.now() % 100000}`;
  await page.getByTestId('save-view-name').fill(name);
  await page.getByTestId('save-view-submit').click();
  await expect(page.getByTestId('save-view-dialog')).toBeHidden();

  await page.goto(`${BASE}/views`);
  await expect(page.getByTestId('views-page')).toBeVisible();
  await expect(page.getByTestId(`view-${name}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/views-page.png` });

  await page.getByTestId(`open-${name}`).click();
  await expect(page.getByTestId('filter-chip-assignee')).toBeVisible();
  await expect(page.getByTestId('filter-chip-priority')).toBeVisible();
  expect(Number(await page.getByTestId('issue-count').innerText())).toBe(twoFilters);

  await page.goto(`${BASE}/views`);
  await page.getByTestId(`share-${name}`).click();
  await expect(page.getByTestId(`share-${name}`)).toHaveAttribute('data-state', 'checked');

  await page.getByTestId(`delete-${name}`).click();
  await expect(page.getByTestId(`view-${name}`)).toBeHidden();
});

test('shift+f removes only the last filter and alt+shift+f clears them all', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-pulkit@noveum.ai').click();
  await page.waitForURL(`${BASE}/my-issues`);

  await page.goto(`${BASE}/team/eng/issues?filter=priority%3Ais%3A1%3Bdue%3Ais%3Anone`);
  await expect(page.getByTestId('filter-chip-priority')).toBeVisible();
  await expect(page.getByTestId('filter-chip-due')).toBeVisible();

  await page.keyboard.press('Shift+F');
  await expect(page.getByTestId('filter-chip-due')).toBeHidden();
  await expect(page.getByTestId('filter-chip-priority')).toBeVisible();

  await page.keyboard.press('Alt+Shift+F');
  await expect(page.getByTestId('filter-chip-priority')).toBeHidden();
  await expect(page).not.toHaveURL(/filter=/);

  await page.keyboard.press('?');
  const overlay = page.getByRole('dialog');
  await expect(overlay.getByText('Add filter')).toBeVisible();
  await expect(overlay.getByText('Remove the last filter')).toBeVisible();
  await expect(overlay.getByText('Clear all filters')).toBeVisible();
  await expect(overlay.getByText('Save as a view')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/shortcuts.png` });
});
