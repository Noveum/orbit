import { beforeEach, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { SYNC_MODELS } from '@orbit/shared/events';
import { createComment, toggleReaction } from '../../src/content/comment-service.ts';
import { createDoc, createDocCollection, setDocAccess } from '../../src/content/doc-service.ts';
import { newId } from '../../src/internal.ts';
import { createInvite } from '../../src/org/invite-service.ts';
import { addTeamMember, createTeam } from '../../src/org/team-service.ts';
import { catchUp, SYNC_CATCHUP_MODELS } from '../../src/realtime/backfill.ts';
import {
  addMember,
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, subscribe, updateIssue } from '../../src/work/issue-service.ts';
import { createView } from '../../src/work/view-service.ts';

function teamKey(): string {
  return `D${newId()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 4)
    .toUpperCase()}`;
}

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

function modelIds(actions: { model: string; modelId: string }[], model: string): string[] {
  return actions.filter((action) => action.model === model).map((action) => action.modelId);
}

describe('catchUp', () => {
  it('covers every synced model so no model silently misses a backfill', () => {
    expect([...SYNC_CATCHUP_MODELS].sort()).toEqual([...SYNC_MODELS].sort());
  });

  it('returns only rows newer than the cursor and reports the new high water mark', async () => {
    const before = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Before the cursor',
    });
    const cursor = (await catchUp(workspace.admin, 0)).syncId;

    const after = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'After the cursor',
    });

    const result = await catchUp(workspace.admin, cursor);
    expect(modelIds(result.actions, 'issue')).toEqual([after.issue.id]);
    expect(modelIds(result.actions, 'issue')).not.toContain(before.issue.id);
    expect(result.syncId).toBeGreaterThanOrEqual(after.issue.syncId);
    expect(result.truncated).toBe(false);
  });

  it('replays the latest row state for an issue that changed many times', async () => {
    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'First title',
    });
    const cursor = (await catchUp(workspace.admin, 0)).syncId;

    await updateIssue(workspace.admin, created.issue.id, { title: 'Second title' });
    const third = await updateIssue(workspace.admin, created.issue.id, { title: 'Third title' });

    const result = await catchUp(workspace.admin, cursor);
    const issues = result.actions.filter((action) => action.model === 'issue');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.data['title']).toBe('Third title');
    expect(issues[0]?.syncId).toBe(third.issue.syncId);
  });

  it('never returns a row from another organization', async () => {
    const other = await createWorkspace('Rival');
    await createIssue(other.admin, { teamId: other.teamId, title: 'Rival roadmap' });
    await createDoc(other.admin, { title: 'Rival strategy' });

    const result = await catchUp(workspace.admin, 0);
    for (const action of result.actions) {
      expect(action.organizationId).toBe(workspace.organizationId);
      expect(action.scopes.some((scope) => scope.includes(other.organizationId))).toBe(false);
      expect(action.scopes.some((scope) => scope.includes(other.teamId))).toBe(false);
    }
  });

  it('sorts every action by sync id so the client can apply them in order', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'One' });
    await createDocCollection(workspace.admin, { name: 'Handbook' });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Two' });

    const result = await catchUp(workspace.admin, 0);
    const ordered = [...result.actions].sort((left, right) => left.syncId - right.syncId);
    expect(result.actions.map((action) => action.syncId)).toEqual(
      ordered.map((action) => action.syncId),
    );
  });

  it('backfills the models that used to share another model name', async () => {
    const teammate = await createUser('Tess Teammate');
    await createInvite(workspace.admin, { email: teammate.email });
    const collection = await createDocCollection(workspace.admin, { name: 'Runbooks' });
    const issue = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Own the on call rota',
    });
    await subscribe(workspace.admin, issue.issue.id);

    const result = await catchUp(workspace.admin, 0);
    const models = new Set(result.actions.map((action) => action.model));
    expect(models.has('invitation')).toBe(true);
    expect(models.has('doc_collection')).toBe(true);
    expect(models.has('issue_subscription')).toBe(true);
    expect(modelIds(result.actions, 'doc_collection')).toEqual([collection.collection.id]);
  });

  it('marks the page truncated when there is more than the caller asked for', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'One' });
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Two' });

    const result = await catchUp(workspace.admin, 0, 1);
    expect(result.actions).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('only returns notifications addressed to the caller', async () => {
    const teammate = await createUser('Nate Notified');
    const notify = (userId: string, title: string, syncId: number) => ({
      id: newId(),
      organizationId: workspace.organizationId,
      userId,
      type: 'issue_assigned',
      actorType: 'user',
      actorId: workspace.admin.userId,
      actorName: 'Nova Admin',
      entityType: 'issue',
      entityId: newId(),
      title,
      url: '/inbox',
      syncId,
    });
    await db
      .insert(schema.notification)
      .values([
        notify(workspace.admin.userId, 'For the admin', 1000),
        notify(teammate.id, 'For a teammate', 1001),
      ]);

    const result = await catchUp(workspace.admin, 0);
    const notifications = result.actions.filter((action) => action.model === 'notification');
    expect(notifications.length).toBeGreaterThan(0);
    for (const action of notifications) {
      expect(action.data['userId']).toBe(workspace.admin.userId);
      expect(action.data['userId']).not.toBe(teammate.id);
    }
  });

  it('scopes a team membership to its team so it cannot cross a team boundary', async () => {
    const joined = await addMember(workspace, 'member', { teamIds: [] });
    await addTeamMember(workspace.admin, workspace.teamId, { userId: joined.user.id });

    const result = await catchUp(workspace.admin, 0);
    const memberships = result.actions.filter((action) => action.model === 'team_member');
    expect(memberships.length).toBeGreaterThan(0);
    for (const action of memberships) {
      expect(action.scopes).toContain(`team:${workspace.teamId}`);
      expect(
        action.scopes.every(
          (scope) => scope.startsWith('team:') === false || scope === `team:${workspace.teamId}`,
        ),
      ).toBe(true);
    }
  });
});

describe('catch up never crosses a team boundary', () => {
  it('hides another team and its issues from a member', async () => {
    const outsider = await createTeam(workspace.admin, {
      name: 'Design',
      key: teamKey(),
    });
    const { principal: member } = await addMember(workspace, 'member', {
      teamIds: [workspace.teamId],
    });

    const mine = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Visible to the member',
    });
    const theirs = await createIssue(workspace.admin, {
      teamId: outsider.team.id,
      title: 'Confidential to Design',
    });

    const result = await catchUp(member, 0);
    const ids = new Set(result.actions.map((action) => action.modelId));

    expect(ids.has(mine.issue.id)).toBe(true);
    expect(ids.has(theirs.issue.id)).toBe(false);

    const bodies = JSON.stringify(result.actions);
    expect(bodies).toContain('Visible to the member');
    expect(bodies).not.toContain('Confidential to Design');
  });

  it('still gives an admin the whole workspace', async () => {
    const outsider = await createTeam(workspace.admin, {
      name: 'Design',
      key: teamKey(),
    });
    const theirs = await createIssue(workspace.admin, {
      teamId: outsider.team.id,
      title: 'Admin can see this',
    });

    const result = await catchUp(workspace.admin, 0);
    expect(result.actions.some((action) => action.modelId === theirs.issue.id)).toBe(true);
  });

  it('gives a guest on no teams none of the workspace issues', async () => {
    await createIssue(workspace.admin, { teamId: workspace.teamId, title: 'Not for guests' });
    const { principal: guest } = await addMember(workspace, 'guest', { teamIds: [] });

    const result = await catchUp(guest, 0);
    expect(JSON.stringify(result.actions)).not.toContain('Not for guests');
  });

  it('keeps pending invitations away from anyone who cannot invite', async () => {
    await createInvite(workspace.admin, {
      email: `secret.${newId().slice(0, 8)}@example.com`,
      role: 'admin',
    });
    const { principal: contributor } = await addMember(workspace, 'contributor');

    const asContributor = await catchUp(contributor, 0);
    expect(asContributor.actions.some((action) => action.model === 'invitation')).toBe(false);

    const asAdmin = await catchUp(workspace.admin, 0);
    expect(asAdmin.actions.some((action) => action.model === 'invitation')).toBe(true);
  });
});

describe('catch up respects document access', () => {
  it('never returns a private doc body to somebody it was not shared with', async () => {
    const { principal: other } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Compensation review',
      content: 'Numbers nobody else should read.',
      visibility: 'private',
    });

    const result = await catchUp(other, 0);
    const payload = JSON.stringify(result.actions);
    expect(payload).not.toContain('Numbers nobody else should read.');
    expect(result.actions.some((action) => action.modelId === doc.id)).toBe(false);
  });

  it('returns a private doc once it is shared', async () => {
    const { principal: invited, user: invitedUser } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Shared plan',
      content: 'For a named few.',
      visibility: 'private',
    });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: invitedUser.id, level: 'read' }],
    });

    const result = await catchUp(invited, 0);
    expect(result.actions.some((action) => action.modelId === doc.id)).toBe(true);
  });

  it('keeps workspace docs reaching everyone', async () => {
    const { principal: guest } = await addMember(workspace, 'guest', { teamIds: [] });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Handbook',
      content: 'Everybody reads this.',
      visibility: 'workspace',
    });
    const result = await catchUp(guest, 0);
    expect(result.actions.some((action) => action.modelId === doc.id)).toBe(true);
  });
});

describe('catch up scopes reactions to the team that owns the issue', () => {
  it('hides a reaction on another team issue from a member', async () => {
    const outsider = await createTeam(workspace.admin, { name: 'Design', key: teamKey() });
    const { principal: member } = await addMember(workspace, 'member', {
      teamIds: [workspace.teamId],
    });

    const theirs = await createIssue(workspace.admin, {
      teamId: outsider.team.id,
      title: 'Confidential to Design',
    });
    const comment = await createComment(workspace.admin, theirs.issue.id, {
      body: 'Only Design should see this thread.',
    });
    const reaction = await toggleReaction(workspace.admin, comment.comment.id, { emoji: '🚀' });

    const result = await catchUp(member, 0);
    const ids = new Set(result.actions.map((action) => action.modelId));

    for (const action of reaction.actions) {
      expect(ids.has(action.modelId)).toBe(false);
    }
  });

  it('still gives a reaction on the member own team issue', async () => {
    const { principal: member } = await addMember(workspace, 'member', {
      teamIds: [workspace.teamId],
    });

    const mine = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ours',
    });
    const comment = await createComment(workspace.admin, mine.issue.id, { body: 'Nice work.' });
    const reaction = await toggleReaction(workspace.admin, comment.comment.id, { emoji: '🚀' });

    const result = await catchUp(member, 0);
    const ids = new Set(result.actions.map((action) => action.modelId));

    const reacted = reaction.actions.filter((action) => action.model === 'reaction');
    expect(reacted.length).toBeGreaterThan(0);
    for (const action of reacted) {
      expect(ids.has(action.modelId)).toBe(true);
    }
  });
});

describe('catch up respects who a saved view was shared with', () => {
  it('never replays a team view to somebody on another team', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: teamKey() });
    const { principal: engineer } = await addMember(workspace, 'member', {
      teamIds: [workspace.teamId],
    });
    const { principal: designer } = await addMember(workspace, 'member', {
      teamIds: [design.team.id],
    });

    const { view } = await createView(engineer, {
      name: 'Engineering reorg',
      filter: { visibility: 'team', teamId: workspace.teamId },
    });

    const forTheDesigner = await catchUp(designer, 0);
    expect(forTheDesigner.actions.some((action) => action.modelId === view.id)).toBe(false);
    expect(JSON.stringify(forTheDesigner.actions)).not.toContain('Engineering reorg');

    const forTheEngineer = await catchUp(engineer, 0);
    expect(forTheEngineer.actions.some((action) => action.modelId === view.id)).toBe(true);
  });

  it('still replays a workspace view to everyone', async () => {
    const design = await createTeam(workspace.admin, { name: 'Design', key: teamKey() });
    const { principal: designer } = await addMember(workspace, 'member', {
      teamIds: [design.team.id],
    });

    const { view } = await createView(workspace.admin, {
      name: 'Everything',
      filter: { visibility: 'workspace' },
    });

    const result = await catchUp(designer, 0);
    expect(result.actions.some((action) => action.modelId === view.id)).toBe(true);
  });
});

describe('a catch up reads one consistent picture', () => {
  it('takes every model from the same snapshot, so nothing slips between queries', async () => {
    const before = await catchUp(workspace.admin, 0);
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Written mid flight',
    });
    const { doc } = await createDoc(workspace.admin, { title: 'Also written' });

    const after = await catchUp(workspace.admin, before.syncId);
    const ids = after.actions.map((action) => action.modelId);

    expect(ids).toContain(issue.id);
    expect(ids).toContain(doc.id);
    expect(after.syncId).toBeGreaterThanOrEqual(Math.max(issue.syncId, doc.syncId));
  });
});
