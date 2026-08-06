import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { createComment } from '../../src/content/comment-service.ts';
import { removeTeamMember } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('subscriber removed from the team', () => {
  it('stops receiving comment bodies', async () => {
    const leaver = await addMember(workspace, 'member', { name: 'Leaver' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ship the hub',
    });
    await createComment(leaver.principal, issue.id, { body: 'Watching this.' });

    await removeTeamMember(workspace.admin, workspace.teamId, leaver.user.id);

    const { comment } = await createComment(workspace.admin, issue.id, {
      body: 'Rotating the production credentials tonight.',
    });

    const rows = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.userId, leaver.user.id),
          eq(schema.notification.entityId, comment.id),
        ),
      );
    console.log('ROWS', JSON.stringify(rows.map((row) => ({ type: row.type, body: row.body }))));
    expect(rows).toHaveLength(0);
  });
});
