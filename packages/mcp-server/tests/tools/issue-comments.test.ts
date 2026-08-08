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
let contributor: TestClient;
let issueIdentifier: string;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const member = await addMember(workspace, 'contributor', 'Connie Contributor');
  contributor = await connect(await mintToken(workspace.organizationId, member.user.id));

  const created = await admin.result('create_issue', {
    team: workspace.teamKey,
    title: 'Passkey sign-in fails on Safari',
  });
  const issue = created['issue'] as { identifier: string };
  issueIdentifier = issue.identifier;

  await admin.result('add_comment', { issue: issueIdentifier, body: 'First, from the admin.' });
  await contributor.result('add_comment', {
    issue: issueIdentifier,
    body: 'Second, from the contributor.',
  });
});

describe('list_issue_comments', () => {
  it('returns the thread oldest first with author names', async () => {
    const result = await admin.result('list_issue_comments', { issue: issueIdentifier });
    const comments = result['comments'] as { body: string; authorName: string }[];

    expect(comments).toHaveLength(2);
    expect(comments[0]?.body).toBe('First, from the admin.');
    expect(comments[0]?.authorName).toBe(workspace.adminUser.name);
    expect(comments[1]?.body).toBe('Second, from the contributor.');
    expect(comments[1]?.authorName).toBe('Connie Contributor');
  });

  it('pages with a cursor', async () => {
    const first = await admin.result('list_issue_comments', { issue: issueIdentifier, limit: 1 });
    expect((first['comments'] as unknown[]).length).toBe(1);
    const cursor = first['nextCursor'] as string;
    expect(cursor).not.toBeNull();

    const second = await admin.result('list_issue_comments', {
      issue: issueIdentifier,
      limit: 1,
      cursor,
    });
    const comments = second['comments'] as { body: string }[];
    expect(comments[0]?.body).toBe('Second, from the contributor.');
  });

  it('is available to a contributor token', async () => {
    const result = await contributor.result('list_issue_comments', { issue: issueIdentifier });
    expect((result['comments'] as unknown[]).length).toBe(2);
  });
});
