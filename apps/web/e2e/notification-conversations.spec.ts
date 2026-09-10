import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, eq, schema } from '@orbit/db';
import { notifyMany } from '@orbit/services/notifications';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { createDoc } from './api.ts';
import { BASE } from './base-url.ts';

// biome-ignore lint/suspicious/noSkippedTests: the legacy rollback mode intentionally does not expose the conversation UI
test.skip(
  process.env['NOTIFICATION_CONVERSATIONS_ENABLED'] !== 'true',
  'Conversation cutover is disabled.',
);

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId(`dev-sign-in-${email}`).click();
  await page.waitForURL(`${BASE}/my-issues`);
  return page;
}

async function seedPullConversation() {
  const [reader] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, 'sam@orbit.example'));
  if (reader === undefined) throw new Error('The browser test reader must be seeded.');
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, reader.id));
  if (membership === undefined) throw new Error('The browser test workspace must be seeded.');
  const organizationId = membership.organizationId;
  const integrationId = randomUUIDv7();
  const repositorySyncId = randomUUIDv7();
  const pullId = randomUUIDv7();
  await db.insert(schema.integration).values({
    id: integrationId,
    organizationId,
    provider: 'github',
    externalId: integrationId,
    connectedById: reader.id,
  });
  await db.insert(schema.githubRepositorySync).values({
    id: repositorySyncId,
    organizationId,
    integrationId,
    repositoryId: '383000',
    repositoryName: 'orbit-demo/engineering',
    teamId: null,
  });
  await db.insert(schema.githubPullRequest).values({
    id: pullId,
    organizationId,
    repositorySyncId,
    repositoryId: '383000',
    repositoryName: 'orbit-demo/engineering',
    number: 383,
    title: 'Make notification conversations reliable',
    url: 'https://github.com/orbit-demo/engineering/pull/383',
    headSha: 'a'.repeat(40),
  });
  const events = [
    {
      type: 'pr_review_requested' as const,
      title: 'Review requested: notification conversations',
      body: 'Please review the grouped inbox, stable unread counters, and Slack thread delivery.',
    },
    {
      type: 'pr_comment' as const,
      title: 'New comment on notification conversations',
      body: 'The duplicate check notifications are now grouped into this single conversation.\n\n- Current-head checks only\n- One Slack root with ordered replies\n- Comments and mentions retain their history',
    },
    {
      type: 'pr_approved' as const,
      title: 'Approved: notification conversations',
      body: 'The integration tests pass. Read, snooze, and dismissal apply to the whole conversation.',
    },
  ];
  for (const [index, event] of events.entries())
    await notifyMany(db, [
      {
        organizationId,
        type: event.type,
        reason: index === 0 ? 'review_requested' : 'subscribed',
        actor: {
          type: 'integration',
          id: `reviewer-${index}`,
          name: ['Alex Morgan', 'Jordan Lee', 'Alex Morgan'][index] ?? 'Reviewer',
        },
        entityType: 'github_pull_request',
        entityId: pullId,
        userIds: [reader.id],
        title: event.title,
        body: event.body,
        url: '/pulls',
        externalUrl: 'https://github.com/orbit-demo/engineering/pull/383',
        source: {
          sourceEventKey: `e2e:${pullId}:${index}`,
          subjectType: 'github_pull_request',
          subjectKey: 'github-pr:383000:383',
          occurredAt: new Date(Date.now() - (3 - index) * 60_000),
          payload: { pullRequestId: pullId },
        },
      },
    ]);
}

async function addDocComment(page: Page, docId: string, body: string) {
  const response = await page.request.post(`${BASE}/api/docs/${docId}/comments`, {
    data: { body },
  });
  expect(response.ok()).toBe(true);
}

async function capture(page: Page, name: string, theme: 'light' | 'dark') {
  if (process.env['ORBIT_CAPTURE_NOTIFICATION_SCREENSHOTS'] !== '1') return;
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
  await page.evaluate((value) => {
    localStorage.setItem('theme', value);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(value);
    document.documentElement.style.colorScheme = value;
  }, theme);
  const directory = resolve(import.meta.dirname, '../../../docs/assets/screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `notification-${name}-${theme}.png`),
    fullPage: false,
    animations: 'disabled',
  });
}

test('groups PR and document history, preserves keyboard actions, and renders both themes', async ({
  browser,
}) => {
  await seedPullConversation();
  const reading = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const writing = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const reader = await signIn(reading, 'sam@orbit.example');
  const author = await signIn(writing, 'alex@orbit.example');
  const doc = await createDoc(reader, 'Release readiness checklist', 'workspace');
  await addDocComment(
    author,
    doc.id,
    '@sam can you check the release sequence before we enable delivery?',
  );
  await addDocComment(
    author,
    doc.id,
    'The migration and backfill are verified. Document replies remain in the same conversation.',
  );
  await reader.goto(`${BASE}/inbox`);
  const conversations = reader.getByRole('list', { name: 'Inbox conversations' });
  await expect(conversations.getByRole('button')).toHaveCount(2);
  await expect(reader.getByTestId('inbox-conversation-history')).toBeVisible();
  await expect(
    reader.getByRole('list', { name: 'Conversation history' }).locator(':scope > li'),
  ).toHaveCount(2);
  for (const theme of ['light', 'dark'] as const)
    await capture(reader, 'document-conversation', theme);
  await reader.getByTestId('inbox-tab-pulls').click();
  await expect(conversations.getByRole('button')).toHaveCount(1);
  await expect(
    reader.getByRole('list', { name: 'Conversation history' }).locator(':scope > li'),
  ).toHaveCount(3);
  for (const theme of ['light', 'dark'] as const)
    await capture(reader, 'pull-request-conversation', theme);
  await reader.keyboard.press('u');
  await expect(conversations.getByText('Read', { exact: true })).toBeAttached();
  await reader.keyboard.press('h');
  await expect(conversations).toHaveCount(0);
  await reader.getByTestId('inbox-tab-mentions').click();
  await expect(conversations.getByRole('button')).toHaveCount(1);
  await reader.keyboard.press('Backspace');
  await expect(conversations).toHaveCount(0);
  const response = await reader.request.get(`${BASE}/api/inbox/conversations?tab=activity`);
  expect(response.ok()).toBe(true);
  const result = z
    .object({
      conversations: z.array(z.unknown()),
      counters: z.object({ unreadCount: z.number() }),
    })
    .parse(await response.json());
  expect(result.conversations).toHaveLength(0);
  expect(result.counters.unreadCount).toBe(0);
  await reader.getByTestId('inbox-tab-activity').click();
  await expect(conversations).toHaveCount(0);
  await addDocComment(author, doc.id, 'A final follow-up resurfaces this same conversation live.');
  await expect(conversations.getByRole('button')).toHaveCount(1);
  await expect(reader.getByTestId('inbox-unread-count')).toHaveText('1 unread');
  await expect(
    reader.getByRole('list', { name: 'Conversation history' }).locator(':scope > li'),
  ).toHaveCount(3);
  await reading.close();
  await writing.close();
});
