import { beforeEach, describe, expect, it } from 'bun:test';
import { createComment, toggleReaction } from '../../src/content/comment-service.ts';
import { newId } from '../../src/internal.ts';
import { createTeam } from '../../src/org/team-service.ts';
import { catchUp } from '../../src/realtime/backfill.ts';
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

describe('reaction backfill probe', () => {
  it('shows whether a member on team A receives reactions on team B issues', async () => {
    const teamB = await createTeam(workspace.admin, {
      name: 'Design',
      key: `D${newId()
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 4)
        .toUpperCase()}`,
    });
    const { principal: alice } = await addMember(workspace, 'member', {
      teamIds: [workspace.teamId],
    });

    const secret = await createIssue(workspace.admin, {
      teamId: teamB.team.id,
      title: 'Confidential to Design',
    });
    const comment = await createComment(workspace.admin, secret.issue.id, {
      body: 'Secret discussion',
    });
    await toggleReaction(workspace.admin, comment.comment.id, { emoji: 'tada' });

    const asAdmin = await catchUp(workspace.admin, 0);
    console.log(
      'admin total actions:',
      asAdmin.actions.length,
      'truncated:',
      asAdmin.truncated,
      'reactions:',
      JSON.stringify(asAdmin.actions.filter((action) => action.model === 'reaction')),
    );

    const result = await catchUp(alice, 0);
    console.log(
      'alice total actions:',
      result.actions.length,
      'truncated:',
      result.truncated,
      'models:',
      JSON.stringify([...new Set(result.actions.map((a) => a.model))]),
    );
    const reactions = result.actions.filter((action) => action.model === 'reaction');
    console.log('reaction actions for alice:', JSON.stringify(reactions, null, 2));
    console.log(
      'secret issue id:',
      secret.issue.id,
      'appears in payload:',
      JSON.stringify(result.actions).includes(secret.issue.id),
    );
    expect(reactions.length).toBe(0);
  });
});
