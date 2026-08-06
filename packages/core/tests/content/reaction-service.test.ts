import { beforeEach, describe, expect, it } from 'bun:test';
import { createComment, listComments, toggleReaction } from '../../src/content/comment-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;
let issueId: string;
let commentId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Reactions',
  });
  issueId = issue.id;
  const { comment } = await createComment(workspace.admin, issueId, { body: 'Ship it' });
  commentId = comment.id;
});

describe('toggleReaction', () => {
  it('adds a reaction and publishes an insert the other tabs can apply', async () => {
    const toggled = await toggleReaction(workspace.admin, commentId, { emoji: '🎉' });

    expect(toggled.active).toBe(true);
    expect(toggled.emoji).toBe('🎉');

    const action = toggled.actions[0];
    expect(action?.model).toBe('reaction');
    expect(action?.action).toBe('insert');
    expect(action?.syncId).toBeGreaterThan(0);
    expect(action?.scopes.length).toBeGreaterThan(0);
    expect(action?.data['emoji']).toBe('🎉');
  });

  it('shows the reaction on the comment it was left on', async () => {
    await toggleReaction(workspace.admin, commentId, { emoji: '🎉' });

    const { comments } = await listComments(workspace.admin, issueId);
    const reactions = comments.find((entry) => entry.comment.id === commentId)?.reactions ?? [];
    expect(reactions.map((row) => row.emoji)).toEqual(['🎉']);
  });

  it('removes the reaction when toggled again and publishes a delete', async () => {
    await toggleReaction(workspace.admin, commentId, { emoji: '🎉' });
    const removed = await toggleReaction(workspace.admin, commentId, { emoji: '🎉' });

    expect(removed.active).toBe(false);
    expect(removed.actions[0]?.action).toBe('delete');
    expect(removed.actions[0]?.model).toBe('reaction');

    const { comments } = await listComments(workspace.admin, issueId);
    expect(comments.find((entry) => entry.comment.id === commentId)?.reactions).toEqual([]);
  });

  it('rejects an emoji the schema does not allow', async () => {
    await expect(toggleReaction(workspace.admin, commentId, { emoji: '' })).rejects.toThrow();
  });
});
