import { beforeEach, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { SYNC_MODELS } from '@orbit/shared/events';
import { createDoc, createDocCollection } from '../content/doc-service.ts';
import { newId } from '../internal.ts';
import { createInvite } from '../org/invite-service.ts';
import { addTeamMember } from '../org/team-service.ts';
import {
  addMember,
  createUser,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../test-support.ts';
import { createIssue, subscribe, updateIssue } from '../work/issue-service.ts';
import { catchUp, SYNC_CATCHUP_MODELS } from './backfill.ts';

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
