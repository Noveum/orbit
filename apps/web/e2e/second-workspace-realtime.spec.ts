import { and, db, eq, schema } from '@orbit/db';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';

const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';
const PROPAGATION_TIMEOUT = 30_000;

const DEMO_EMAIL = 'pulkit@noveum.ai';
const FIRST_WORKSPACE_ID = 'org_noveum_demo';
const FIRST_WORKSPACE_BOARD = '/team/eng/board';

async function rewriteFirstWorkspaceMembershipRow(email: string): Promise<void> {
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (owner === undefined) throw new Error(`Seed user ${email} is missing, run bun run db:seed.`);

  const [membership] = await db
    .select({ id: schema.member.id, createdAt: schema.member.createdAt })
    .from(schema.member)
    .where(
      and(eq(schema.member.userId, owner.id), eq(schema.member.organizationId, FIRST_WORKSPACE_ID)),
    )
    .limit(1);
  if (membership === undefined) throw new Error(`${email} is not a member of the demo workspace.`);

  await db
    .update(schema.member)
    .set({ createdAt: membership.createdAt })
    .where(eq(schema.member.id, membership.id));
}

async function signIn(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${DEMO_EMAIL}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function openFirstWorkspaceBoard(page: Page): Promise<void> {
  await page.goto(`${BASE}${FIRST_WORKSPACE_BOARD}`);
  await expect(page.getByTestId('board-column-Todo')).toBeVisible();
  await expect(page.getByTestId('workspace-switcher')).toContainText('Noveum');
}

test('realtime keeps working in the first workspace after a second one exists', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const suffix = `${Date.now() % 1_000_000}`;
  const workspaceName = `Nebula ${suffix}`;

  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const creator = await signIn(owner);

  await creator.goto(`${BASE}/workspaces/new`);
  await creator.getByLabel('Workspace name').fill(workspaceName);
  await expect(creator.getByLabel('Workspace address')).toHaveValue(`nebula-${suffix}`);
  await creator.getByRole('button', { name: 'Create workspace' }).click();
  await creator.waitForURL(/\/team\/.+\/board/, { timeout: 60_000 });
  await expect(creator.getByTestId('workspace-switcher')).toContainText(workspaceName);

  await creator.getByTestId('workspace-switcher').click();
  await creator.getByTestId('workspace-option-noveum').click();
  await creator.waitForURL(`${BASE}/my-issues`);
  await openFirstWorkspaceBoard(creator);

  await rewriteFirstWorkspaceMembershipRow(DEMO_EMAIL);

  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const viewer = await signIn(viewerContext);
  await openFirstWorkspaceBoard(viewer);

  const title = `Second workspace live ${suffix}`;
  await creator.keyboard.press('c');
  await expect(creator.getByTestId('quick-create')).toBeVisible();
  await creator.getByTestId('quick-create-title').fill(title);
  await creator.getByTestId('quick-create-submit').click();
  await expect(creator.getByText(title)).toBeVisible();

  await expect(viewer.getByText(title)).toBeVisible({ timeout: PROPAGATION_TIMEOUT });
  await viewer.screenshot({ path: `${SHOTS}/second-workspace-live.png` });

  await viewerContext.close();
  await owner.close();
});
