import { beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import { createIssue } from '../work/issue-service.ts';
import { createComment, listComments } from './comment-service.ts';

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
