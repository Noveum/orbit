import { beforeEach, describe, expect, it } from 'bun:test';
import { createIssue } from '@orbit/core';
import { createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { attachIssueDecorations } from '@/lib/api/issues.ts';

beforeEach(resetDatabase);

describe('canonical Web issue responses', () => {
  it('F7 hydrates raw mutation rows through the shared ActorView reader', async () => {
    const workspace = await createWorkspace('WebActors');
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Human assignment',
      assigneeId: workspace.adminUser.id,
    });
    const [response] = await attachIssueDecorations([issue]);
    const human = {
      type: 'user',
      id: workspace.adminUser.id,
      name: workspace.adminUser.name,
      avatar: null,
      deleted: false,
    };
    expect(response).toMatchObject({
      creator: human,
      assignee: human,
      owner: human,
      labelIds: [],
      reviewerIds: [],
    });
  });
});
