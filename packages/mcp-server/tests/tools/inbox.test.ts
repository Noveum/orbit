import { beforeAll, describe, expect, it } from 'bun:test';
import {
  addMember,
  connect,
  createWorkspace,
  mintToken,
  resetDatabase,
} from '../../src/test-helpers.ts';

type TestClient = Awaited<ReturnType<typeof connect>>;
type TestWorkspace = Awaited<ReturnType<typeof createWorkspace>>;

let workspace: TestWorkspace;
let admin: TestClient;
let agent: TestClient;
let agentHandle: string;
let issueIdentifier: string;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));

  const member = await addMember(workspace, 'contributor', 'Yodu Desk');
  agentHandle = member.user.handle;
  agent = await connect(await mintToken(workspace.organizationId, member.user.id));

  const created = await admin.result('create_issue', {
    team: workspace.teamKey,
    title: 'Billing webhook drops retries',
  });
  issueIdentifier = (created['issue'] as { identifier: string }).identifier;

  await admin.result('add_comment', {
    issue: issueIdentifier,
    body: `@${agentHandle} can you take a look at this?`,
  });
});

describe('list_notifications', () => {
  it('returns the mention with the issue resolved from the comment', async () => {
    const result = await agent.result('list_notifications', { unreadOnly: true });
    const rows = result['notifications'] as {
      type: string;
      read: boolean;
      issue: { identifier: string; title: string; teamKey: string } | null;
    }[];

    const mention = rows.find((row) => row.type === 'mention');
    expect(mention).toBeDefined();
    expect(mention?.read).toBe(false);
    expect(mention?.issue?.identifier).toBe(issueIdentifier);
    expect(mention?.issue?.title).toBe('Billing webhook drops retries');
    expect(mention?.issue?.teamKey).toBe(workspace.teamKey);
  });

  it('never returns a notification the caller authored', async () => {
    await agent.result('add_comment', { issue: issueIdentifier, body: `Replying to myself.` });
    const result = await agent.result('list_notifications', {});
    const rows = result['notifications'] as { title: string }[];
    expect(rows.every((row) => !row.title.includes('Replying to myself'))).toBe(true);
  });

  it('filters by type, returning that type and withholding the others', async () => {
    const assigned = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Rotate the signing key',
      assignee: agentHandle,
    });
    const assignedIdentifier = (assigned['issue'] as { identifier: string }).identifier;

    const result = await agent.result('list_notifications', { type: 'issue_assigned' });
    const rows = result['notifications'] as {
      type: string;
      issue: { identifier: string } | null;
    }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.type === 'issue_assigned')).toBe(true);
    expect(rows.some((row) => row.issue?.identifier === assignedIdentifier)).toBe(true);
    expect(rows.some((row) => row.issue?.identifier === issueIdentifier)).toBe(false);

    const unfiltered = await agent.result('list_notifications', {});
    const everything = unfiltered['notifications'] as { type: string }[];
    expect(everything.some((row) => row.type === 'mention')).toBe(true);
  });

  it('scopes to the caller, so one user never sees another inbox', async () => {
    const result = await admin.result('list_notifications', { unreadOnly: true });
    const rows = result['notifications'] as { type: string }[];
    expect(rows.some((row) => row.type === 'mention')).toBe(false);
  });
});

describe('mark_notification_read', () => {
  it('marks a notification read so it leaves the unread queue', async () => {
    const before = await agent.result('list_notifications', { unreadOnly: true });
    const rows = before['notifications'] as { id: string }[];
    const target = rows[0];
    expect(target).toBeDefined();

    const marked = await agent.result('mark_notification_read', { ids: [target?.id ?? ''] });
    expect(marked['markedIds']).toEqual([target?.id]);

    const after = await agent.result('list_notifications', { unreadOnly: true });
    const remaining = after['notifications'] as { id: string }[];
    expect(remaining.some((row) => row.id === target?.id)).toBe(false);
  });

  it('cannot mark another user notification read', async () => {
    const mine = await agent.result('list_notifications', {});
    const rows = mine['notifications'] as { id: string }[];
    const target = rows[0];
    expect(target).toBeDefined();

    const result = await admin.result('mark_notification_read', { ids: [target?.id ?? ''] });
    expect(result['markedIds']).toEqual([]);
  });

  it('is withheld from a read-only token', async () => {
    const readOnly = await connect(
      await mintToken(
        workspace.organizationId,
        workspace.adminUser.id,
        'Read only client',
        'openid profile email orbit.read',
      ),
    );
    const listed = await readOnly.client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain('list_notifications');
    expect(names).not.toContain('mark_notification_read');
    await readOnly.close();
  });
});
