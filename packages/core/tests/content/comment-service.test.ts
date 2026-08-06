import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from '../../src/content/comment-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';
import { createProject } from '../../src/work/project-service.ts';

let workspace: Workspace;
let issueId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Long thread',
  });
  issueId = issue.id;
});

async function errorOf(run: () => Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await run();
  } catch (error: unknown) {
    const thrown = error as { code?: unknown; status?: unknown };
    return {
      code: typeof thrown.code === 'string' ? thrown.code : 'not-a-domain-error',
      status: typeof thrown.status === 'number' ? thrown.status : 0,
    };
  }
  throw new Error('the call was expected to throw and did not');
}

async function bodyOf(commentId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ body: schema.comment.body })
    .from(schema.comment)
    .where(eq(schema.comment.id, commentId))
    .limit(1);
  return row?.body;
}

async function writeComments(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await createComment(workspace.admin, issueId, { body: `Comment ${index}` });
  }
}

describe('listComments', () => {
  it('returns one bounded page with a cursor for the rest', async () => {
    await writeComments(60);

    const first = await listComments(workspace.admin, issueId);
    expect(first.comments).toHaveLength(50);
    expect(first.comments[0]?.comment.body).toBe('Comment 0');
    expect(first.nextCursor).not.toBeNull();

    const second = await listComments(workspace.admin, issueId, { cursor: first.nextCursor });
    expect(second.comments).toHaveLength(10);
    expect(second.comments[0]?.comment.body).toBe('Comment 50');
    expect(second.nextCursor).toBeNull();
  });

  it('reports no cursor when the thread fits in one page', async () => {
    await writeComments(3);

    const page = await listComments(workspace.admin, issueId, { limit: 50 });
    expect(page.comments).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });
});

describe('updateComment only ever lets the author rewrite a comment', () => {
  it('rewrites the body and bumps the sync id for the author', async () => {
    const author = await addMember(workspace, 'member', { name: 'Author' });
    const created = await createComment(author.principal, issueId, { body: 'First take.' });

    const updated = await updateComment(author.principal, created.comment.id, {
      body: 'Second take.',
    });

    expect(updated.comment.body).toBe('Second take.');
    expect(updated.comment.syncId).toBeGreaterThan(created.comment.syncId);
    expect(updated.comment.editedAt).not.toBeNull();
    expect(await bodyOf(created.comment.id)).toBe('Second take.');
    expect(updated.actions[0]?.action).toBe('update');
  });

  it('refuses another member on the same team and leaves the body alone', async () => {
    const author = await addMember(workspace, 'member', { name: 'Author' });
    const teammate = await addMember(workspace, 'member', { name: 'Teammate' });
    const created = await createComment(author.principal, issueId, { body: 'First take.' });

    const failure = await errorOf(() =>
      updateComment(teammate.principal, created.comment.id, { body: 'Rewritten by somebody.' }),
    );

    expect(failure).toEqual({ code: 'forbidden', status: 403 });
    expect(await bodyOf(created.comment.id)).toBe('First take.');
  });

  it('refuses a workspace admin who did not write it', async () => {
    const author = await addMember(workspace, 'member', { name: 'Author' });
    const created = await createComment(author.principal, issueId, { body: 'First take.' });

    const failure = await errorOf(() =>
      updateComment(workspace.admin, created.comment.id, { body: 'Rewritten by the admin.' }),
    );

    expect(failure).toEqual({ code: 'forbidden', status: 403 });
    expect(await bodyOf(created.comment.id)).toBe('First take.');
  });

  it('cannot reach a comment that belongs to another workspace', async () => {
    const other = await createWorkspace('Orion');
    const created = await createComment(workspace.admin, issueId, { body: 'Ours.' });
    const outsider: Principal = other.admin;

    const failure = await errorOf(() =>
      updateComment(outsider, created.comment.id, { body: 'Theirs now.' }),
    );

    expect(failure).toEqual({ code: 'not_found', status: 404 });
    expect(await bodyOf(created.comment.id)).toBe('Ours.');
  });
});

describe('deleteComment splits its own from anybody else', () => {
  it('lets the author retract their own comment', async () => {
    const author = await addMember(workspace, 'contributor', { name: 'Author' });
    const created = await createComment(author.principal, issueId, { body: 'Mine.' });

    const actions = await deleteComment(author.principal, created.comment.id);

    expect(actions[0]?.action).toBe('delete');
    const page = await listComments(workspace.admin, issueId);
    expect(page.comments).toHaveLength(0);
  });

  it('refuses a contributor who did not write it', async () => {
    const author = await addMember(workspace, 'member', { name: 'Author' });
    const contributor = await addMember(workspace, 'contributor', { name: 'Passer By' });
    const created = await createComment(author.principal, issueId, { body: 'Mine.' });

    const failure = await errorOf(() => deleteComment(contributor.principal, created.comment.id));

    expect(failure).toEqual({ code: 'forbidden', status: 403 });
    expect((await listComments(workspace.admin, issueId)).comments).toHaveLength(1);
  });

  it('lets a moderator delete somebody else comment', async () => {
    const author = await addMember(workspace, 'contributor', { name: 'Author' });
    const created = await createComment(author.principal, issueId, { body: 'Mine.' });

    const actions = await deleteComment(workspace.admin, created.comment.id);

    expect(actions[0]?.action).toBe('delete');
    expect((await listComments(workspace.admin, issueId)).comments).toHaveLength(0);
  });

  it('cannot reach a comment that belongs to another workspace', async () => {
    const other = await createWorkspace('Orion');
    const created = await createComment(workspace.admin, issueId, { body: 'Ours.' });

    const failure = await errorOf(() => deleteComment(other.admin, created.comment.id));

    expect(failure).toEqual({ code: 'not_found', status: 404 });
    expect((await listComments(workspace.admin, issueId)).comments).toHaveLength(1);
  });
});

describe('comment delta scoping', () => {
  it('publishes a comment to the issue and its team, never to the project', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Watched by everybody',
      teamIds: [workspace.teamId],
    });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'On a project',
      projectId: project.id,
    });

    const created = await createComment(workspace.admin, issue.id, { body: 'Team only.' });

    const action = created.actions[0];
    if (action === undefined) throw new Error('no action published');
    expect(action.scopes.some((scope) => scope.startsWith('team:'))).toBe(true);
    expect(action.scopes.some((scope) => scope.startsWith('issue:'))).toBe(true);
    expect(action.scopes.some((scope) => scope.startsWith('project:'))).toBe(false);
  });
});
