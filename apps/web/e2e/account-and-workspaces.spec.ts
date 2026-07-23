import { randomUUID } from 'node:crypto';
import { db, eq, schema } from '@orbit/db';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

const BASE = process.env['ORBIT_E2E_BASE_URL'] ?? 'http://localhost:3011';
const SHOTS = process.env['ORBIT_E2E_SHOTS'] ?? 'test-results';

const DEMO_EMAIL = 'pulkit@noveum.ai';

async function ensureLinkedProvider(email: string, providerId: string): Promise<void> {
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (owner === undefined) throw new Error(`Seed user ${email} is missing, run pnpm db:seed.`);

  const existing = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(eq(schema.account.userId, owner.id));
  if (existing.some((row) => row.id.length > 0)) return;

  await db.insert(schema.account).values({
    id: randomUUID(),
    accountId: `e2e-${providerId}-${owner.id}`,
    providerId,
    userId: owner.id,
  });
}

test.beforeAll(async () => {
  await ensureLinkedProvider(DEMO_EMAIL, 'github');
});

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function enableVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('account settings, passkeys, and workspace switching', async ({ browser }) => {
  test.setTimeout(180_000);

  const suffix = `${Date.now() % 1_000_000}`;
  const workspaceName = `Comet ${suffix}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await signIn(context, 'pulkit@noveum.ai');

  await page.goto(`${BASE}/settings/account`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(page.getByLabel('Handle')).toHaveValue('pulkit');
  await page.screenshot({
    path: `${SHOTS}/01-account-profile.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await page.goto(`${BASE}/settings/account/passkeys`);
  const leftovers = page.getByTestId('passkey-list').getByRole('button', { name: 'Remove' });
  for (let remaining = await leftovers.count(); remaining > 0; remaining -= 1) {
    await leftovers.first().click();
    await expect(leftovers).toHaveCount(remaining - 1);
  }

  await page.goto(`${BASE}/settings/account/connections`);
  const github = page.getByTestId('provider-github');
  await expect(github.getByText('Connected')).toBeVisible();
  await expect(github.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
  await expect(
    page.getByText('This is the only way you can sign in.', { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/02-connections-github-linked.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await enableVirtualAuthenticator(page);
  await page.goto(`${BASE}/settings/account/passkeys`);
  await page.getByLabel('Name this passkey').fill('Work laptop');
  await page.getByTestId('add-passkey').click();
  await expect(page.getByTestId('passkey-list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Work laptop')).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/03-passkey-added.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await page.goto(`${BASE}/settings/account/connections`);
  await expect(
    page.getByTestId('provider-github').getByRole('button', { name: 'Disconnect' }),
  ).toBeEnabled();
  await page.screenshot({
    path: `${SHOTS}/04-connections-unlockable.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await page.goto(`${BASE}/settings/account/sessions`);
  await expect(page.getByTestId('sessions-panel')).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/05-sessions.png`,
    fullPage: true,
    animations: 'disabled',
  });

  for (const section of ['general', 'members', 'teams', 'notifications']) {
    await page.goto(`${BASE}/settings/${section}`);
    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  }

  await page.getByTestId('workspace-switcher').click();
  await expect(page.getByTestId('workspace-option-noveum')).toBeVisible();
  await page.getByTestId('create-workspace').click();
  await page.waitForURL(`${BASE}/workspaces/new`);
  await page.getByLabel('Workspace name').fill(workspaceName);
  await expect(page.getByLabel('Workspace address')).toHaveValue(`comet-${suffix}`);
  await page.screenshot({
    path: `${SHOTS}/06-create-workspace.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.waitForURL(/\/team\/.+\/board/, { timeout: 30_000 });
  await expect(page.getByTestId('workspace-switcher')).toContainText(workspaceName);
  await page.screenshot({
    path: `${SHOTS}/07-new-workspace-board.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByTestId('workspace-switcher').click();
  await expect(page.getByTestId('workspace-option-noveum')).toBeVisible();
  await expect(page.getByTestId(`workspace-option-comet-${suffix}`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.screenshot({
    path: `${SHOTS}/08-switcher-both-workspaces.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByTestId('workspace-option-noveum').click();
  await page.waitForURL(`${BASE}/my-issues`);
  await expect(page.getByTestId('workspace-switcher')).toContainText('Noveum');
  await page.screenshot({
    path: `${SHOTS}/09-switched-back.png`,
    fullPage: true,
    animations: 'disabled',
  });

  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const teammate = await signIn(otherContext, 'shashank@noveum.ai');
  await teammate.getByTestId('workspace-switcher').click();
  await expect(teammate.getByTestId('workspace-option-noveum')).toBeVisible();
  await expect(teammate.getByTestId(`workspace-option-comet-${suffix}`)).toHaveCount(0);
  await teammate.screenshot({
    path: `${SHOTS}/10-teammate-sees-only-noveum.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await otherContext.close();
  await context.close();
});
