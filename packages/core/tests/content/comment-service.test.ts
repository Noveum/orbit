import { beforeEach, describe, expect, it } from 'bun:test';
import { createComment, listComments } from '../../src/content/comment-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
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
