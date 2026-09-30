import { expect, test } from '@playwright/test';
import { bootstrapSchema, issueListSchema } from '../src/lib/query/schemas.ts';
import { BASE } from './base-url.ts';

test('standup creation keeps its assignee and draft while inspecting similar tasks', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto(`${BASE}/login`);
  await page.getByTestId('dev-sign-in-alex@orbit.example').click();
  await page.waitForURL(`${BASE}/my-issues`);
  await page.goto(`${BASE}/standup`);
  const bootstrap = bootstrapSchema.parse(await (await page.request.get('/api/bootstrap')).json());
  const person = bootstrap.members.find((member) => member.handle === 'sam');
  if (person === undefined) throw new Error('Missing demo member');
  await page.getByTestId(`standup-tile-${person.id}`).click();
  const { issues } = issueListSchema.parse(
    await (
      await page.request.get(`/api/issues?view=standup&participantId=${person.id}&limit=100`)
    ).json(),
  );
  const existing = issues.find(
    (issue) =>
      issue.canOpen !== false &&
      issue.completedAt === null &&
      issue.canceledAt === null &&
      issue.parentId === null,
  );
  if (existing === undefined) throw new Error('Missing active demo task');
  await page.keyboard.press('c');
  const modal = page.getByTestId('quick-create');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('quick-create-assignee')).toContainText(person.name);
  await page.getByTestId('quick-create-team').click();
  const team = bootstrap.teams.find((entry) => entry.id === existing.teamId);
  if (team === undefined) throw new Error('Missing demo team');
  await page.getByRole('menuitemradio', { name: team.name, exact: true }).click();
  await page.getByTestId('quick-create-title').fill(existing.title);
  const editor = page.getByTestId('quick-create-description').locator('[contenteditable="true"]');
  await editor.fill('Review the existing task before creating this follow-up.');
  await modal.getByRole('button', { name: /No priority/ }).click();
  await page.getByRole('menuitemradio', { name: /High/ }).click();
  const suggestion = page
    .getByTestId('duplicate-suggestions')
    .getByRole('link', { name: `${existing.identifier} ${existing.title}`, exact: true });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  const sidebar = page.getByTestId('issue-peek');
  await expect(sidebar).toHaveAttribute('aria-label', `Peek ${existing.identifier}`);
  await expect(sidebar.getByTestId('issue-title')).toHaveValue(existing.title);
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(/\/standup\?person=/);
  await page.screenshot({
    path: testInfo.outputPath('similar-task-sidebar.png'),
    style: 'nextjs-portal { display: none; }',
  });
  const card = page.locator('[data-testid^="issue-card-"] a').first();
  const href = await card.getAttribute('href');
  await card.click();
  await expect(page.getByTestId('issue-peek')).toHaveCount(1);
  await expect(page.getByTestId('issue-peek')).toHaveAttribute(
    'aria-label',
    `Peek ${href?.split('/').at(-1)}`,
  );
  await page.getByTestId('issue-peek').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('issue-peek')).toBeHidden();
  await page.keyboard.press('c');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('quick-create-title')).toHaveValue(existing.title);
  await expect(editor).toHaveText('Review the existing task before creating this follow-up.');
  await expect(page.getByTestId('quick-create-assignee')).toContainText(person.name);
  await expect(modal.getByRole('button', { name: /High/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('restored-task-draft.png'),
    style: 'nextjs-portal { display: none; }',
  });
});
