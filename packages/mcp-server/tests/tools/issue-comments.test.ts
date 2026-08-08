import { beforeAll, describe, expect, it } from 'bun:test';
import { createComment } from '@orbit/core';
import { db, eq, schema, sql } from '@orbit/db';
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

  it('returns an empty thread and a null cursor for an issue with no comments', async () => {
    const created = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Nobody has said anything yet',
    });
    const quiet = created['issue'] as { identifier: string };

    const result = await admin.result('list_issue_comments', { issue: quiet.identifier });

    expect(result['comments']).toEqual([]);
    expect(result['nextCursor']).toBeNull();
  });

  it('falls back to Unknown once the comment author has no user row left', async () => {
    const created = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Its commenter will be removed',
    });
    const issue = created['issue'] as { id: string; identifier: string };

    const doomed = await addMember(workspace, 'contributor', 'Gone Already');
    await createComment(doomed.principal, issue.id, { body: 'I will not be here long.' });

    await db.execute(sql`alter table "user" disable trigger all`);
    try {
      await db.delete(schema.user).where(eq(schema.user.id, doomed.user.id));
    } finally {
      await db.execute(sql`alter table "user" enable trigger all`);
    }

    const result = await admin.result('list_issue_comments', { issue: issue.identifier });
    const comments = result['comments'] as { authorName: string }[];

    expect(comments).toHaveLength(1);
    expect(comments[0]?.authorName).toBe('Unknown');
  });
});
