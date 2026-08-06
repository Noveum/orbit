import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { createComment } from '../../src/content/comment-service.ts';
import { createDocComment } from '../../src/content/doc-comment-service.ts';
import { createDoc, setDocAccess, updateDoc } from '../../src/content/doc-service.ts';
import { removeTeamMember } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, moveIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function inboxFor(userId: string, entityId: string) {
  return await db
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), eq(schema.notification.entityId, entityId)));
}

describe('a subscriber who can no longer read the issue', () => {
  it('stops receiving comments once they leave the team', async () => {
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

    expect(await inboxFor(leaver.user.id, comment.id)).toHaveLength(0);
  });

  it('still receives comments while they are on the team', async () => {
    const watcher = await addMember(workspace, 'member', { name: 'Watcher' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ship the hub',
    });
    await createComment(watcher.principal, issue.id, { body: 'Watching this.' });

    const { comment } = await createComment(workspace.admin, issue.id, { body: 'Landed.' });

    expect(await inboxFor(watcher.user.id, comment.id)).toHaveLength(1);
  });

  it('stops hearing about status changes once they leave the team', async () => {
    const leaver = await addMember(workspace, 'member', { name: 'Leaver' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ship the hub',
    });
    await createComment(leaver.principal, issue.id, { body: 'Watching this.' });
    await removeTeamMember(workspace.admin, workspace.teamId, leaver.user.id);

    const started = workspace.states.find((state) => state.category === 'started');
    await updateIssue(workspace.admin, issue.id, { stateId: started?.id ?? '' });

    const rows = (await inboxFor(leaver.user.id, issue.id)).filter(
      (row) => row.type === 'issue_status_changed',
    );
    expect(rows).toHaveLength(0);
  });
});

describe('a mention in a restricted doc', () => {
  it('does not reach someone the doc was never shared with', async () => {
    const outsider = await addMember(workspace, 'member', { name: 'Outsider' });
    const { doc } = await createDoc(workspace.admin, { title: 'Rotation plan', content: '' });
    await updateDoc(workspace.admin, doc.id, { visibility: 'private' });

    await updateDoc(workspace.admin, doc.id, {
      content: `Handing this to @${outsider.user.handle} tonight.`,
    });

    expect(await inboxFor(outsider.user.id, doc.id)).toHaveLength(0);
  });

  it('reaches someone the doc was shared with', async () => {
    const invited = await addMember(workspace, 'member', { name: 'Invited' });
    const { doc } = await createDoc(workspace.admin, { title: 'Rotation plan', content: '' });
    await updateDoc(workspace.admin, doc.id, { visibility: 'private' });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: invited.user.id, level: 'read' }],
    });

    await updateDoc(workspace.admin, doc.id, {
      content: `Handing this to @${invited.user.handle} tonight.`,
    });

    expect(await inboxFor(invited.user.id, doc.id)).toHaveLength(1);
  });
});

describe('a doc comment on a restricted doc', () => {
  it('does not reach a subscriber whose access was revoked', async () => {
    const reader = await addMember(workspace, 'member', { name: 'Reader' });
    const { doc } = await createDoc(workspace.admin, { title: 'Rotation plan', content: 'Draft' });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: reader.user.id, level: 'read' }],
    });
    await createDocComment(reader.principal, doc.id, { body: 'Following along.' });

    await updateDoc(workspace.admin, doc.id, { visibility: 'private' });
    await setDocAccess(workspace.admin, doc.id, { grants: [] });

    const { comment } = await createDocComment(workspace.admin, doc.id, {
      body: 'The new key is in the vault.',
    });

    expect(await inboxFor(reader.user.id, comment.id)).toHaveLength(0);
  });
});

describe('moving an issue on the board', () => {
  it('notifies subscribers about the status change', async () => {
    const watcher = await addMember(workspace, 'member', { name: 'Watcher' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ship the hub',
    });
    await createComment(watcher.principal, issue.id, { body: 'Watching this.' });
    const started = workspace.states.find((state) => state.category === 'started');

    await moveIssue(workspace.admin, issue.id, { stateId: started?.id ?? '' });

    const rows = (await inboxFor(watcher.user.id, issue.id)).filter(
      (row) => row.type === 'issue_status_changed',
    );
    expect(rows).toHaveLength(1);
  });

  it('notifies the person a drag assigns the issue to', async () => {
    const taker = await addMember(workspace, 'member', { name: 'Taker' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ship the hub',
    });

    await moveIssue(workspace.admin, issue.id, { assigneeId: taker.user.id });

    const rows = (await inboxFor(taker.user.id, issue.id)).filter(
      (row) => row.type === 'issue_assigned',
    );
    expect(rows).toHaveLength(1);
  });
});
