import { readFile, unlink } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { connectOverHttp, type TestClient } from '../../../packages/mcp-server/src/test-helpers.ts';
import { BASE } from './base-url.ts';

const DEMO_EMAIL = 'alex@orbit.example';
const savedTokenSchema = z.object({
  accessToken: z.string().min(1),
  agentName: z.string().min(1),
  agentId: z.string().min(1),
  teamKey: z.string().min(1),
  issueIdentifier: z.string().min(1),
  mcpUrl: z.string().url(),
});

function tokenFilePath(): string {
  const path = process.env['ORBIT_MCP_VALIDATION_TOKEN_FILE'];
  if (path === undefined || path.trim().length === 0) {
    throw new Error('ORBIT_MCP_VALIDATION_TOKEN_FILE is required for the writer-off phase.');
  }
  return path;
}

test('a fresh Writer-off Web process blocks Agent writes and keeps Human writes available', async ({
  browser,
}) => {
  expect(process.env['ORBIT_AGENT_IDENTITY_READ']).toBe('true');
  expect(process.env['ORBIT_AGENT_CONSENT']).toBe('true');
  expect(process.env['ORBIT_AGENT_ISSUE_WRITE']).toBe('false');
  expect(process.env['ORBIT_ISSUE_OUTBOX_DISPATCH']).toBe('true');
  const tokenFile = tokenFilePath();
  let client: TestClient | null = null;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const rawToken: unknown = JSON.parse(await readFile(tokenFile, 'utf8'));
    const saved = savedTokenSchema.parse(rawToken);
    client = await connectOverHttp(saved.accessToken, saved.mcpUrl);
    const identity = await client.result('get_me');
    expect(identity['actor']).toMatchObject({
      type: 'agent',
      id: saved.agentId,
      name: saved.agentName,
    });
    const refused = await client.call('create_issue', {
      team: saved.teamKey,
      title: `Writer off ${saved.agentName}`,
      assignee: null,
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain(
      'Agent issue writes are unavailable in this release.',
    );

    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByTestId(`dev-sign-in-${DEMO_EMAIL}`).click();
    await page.waitForURL(`${BASE}/my-issues`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE}/team/${saved.teamKey.toLowerCase()}/board`);
    await expect(page.getByTestId('board-column-Todo')).toBeVisible();
    const humanIssueTitle = `Human after writer gate ${saved.agentId.slice(0, 8)}`;
    await page.keyboard.press('c');
    await expect(page.getByTestId('quick-create')).toBeVisible();
    await page.getByTestId('quick-create-title').fill(humanIssueTitle);
    await page.getByTestId('quick-create-submit').click();
    await expect(page.getByText(humanIssueTitle, { exact: true })).toBeVisible();
    console.info(
      JSON.stringify({
        webProcess: 'fresh Next.js process',
        gates: {
          identityRead: process.env['ORBIT_AGENT_IDENTITY_READ'],
          consent: process.env['ORBIT_AGENT_CONSENT'],
          issueWriter: process.env['ORBIT_AGENT_ISSUE_WRITE'],
          outboxDispatch: process.env['ORBIT_ISSUE_OUTBOX_DISPATCH'],
        },
        agentRead: 'passed',
        agentWrite: 'denied',
        humanWrite: 'passed',
        humanIssueTitle: humanIssueTitle,
      }),
    );
  } finally {
    if (client !== null) await client.close().catch(() => undefined);
    await context.close();
    await unlink(tokenFile).catch(() => undefined);
  }
});
