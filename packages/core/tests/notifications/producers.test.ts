import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { DEDUPE_WINDOW_MS } from '@orbit/services/notifications';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { createComment } from '../../src/content/comment-service.ts';
import { createDocComment } from '../../src/content/doc-comment-service.ts';
import { createDoc, updateDoc } from '../../src/content/doc-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;
let grace: Awaited<ReturnType<typeof addMember>>;
let linus: Awaited<ReturnType<typeof addMember>>;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  grace = await addMember(workspace, 'member', { name: 'Grace' });
  linus = await addMember(workspace, 'member', { name: 'Linus' });
});

function notificationActions(actions: readonly SyncAction[]): SyncAction[] {
  return actions.filter((action) => action.model === 'notification');
}

async function inboxOf(userId: string) {
  return await db
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.userId, userId),
        eq(schema.notification.organizationId, workspace.organizationId),
      ),
    );
}

async function ageNotifications(userId: string) {
  await db
    .update(schema.notification)
    .set({ createdAt: new Date(Date.now() - 2 * DEDUPE_WINDOW_MS) })
    .where(eq(schema.notification.userId, userId));
}

async function rowsAbout(userId: string, entityId: string) {
  const rows = await db
    .select({ type: schema.notification.type, reason: schema.notification.reason })
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.userId, userId),
        eq(schema.notification.entityId, entityId),
        eq(schema.notification.organizationId, workspace.organizationId),
      ),
    );
  return rows;
}

async function newIssue(title = 'Ship the hub', description = '') {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title,
    description,
  });
  return issue;
}

describe('mentions in an issue comment', () => {
  it('notifies the mentioned teammate and deep links to that comment', async () => {
    const issue = await newIssue();
    const { comment, actions } = await createComment(workspace.admin, issue.id, {
      body: `Can you look at this @${grace.user.handle}?`,
    });

    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('mention');
    expect(rows[0]?.reason).toBe('mentioned');
    expect(rows[0]?.entityType).toBe('comment');
    expect(rows[0]?.entityId).toBe(comment.id);
    expect(rows[0]?.url).toBe(`/issue/${issue.identifier}#comment-${comment.id}`);
    expect(notificationActions(actions)).toHaveLength(1);
  });

  it('publishes the notification to the recipient scope alone, never the team or the org', async () => {
    const issue = await newIssue();
    const { actions } = await createComment(workspace.admin, issue.id, {
      body: `Heads up @${grace.user.handle}`,
    });

    const published = notificationActions(actions);
    expect(published).toHaveLength(1);
    const action = published[0];
    expect(action?.scopes).toEqual([scopes.user(grace.user.id)]);
    expect(action?.scopes).not.toContain(scopes.issue(issue.id));
    expect(action?.scopes).not.toContain(scopes.team(workspace.teamId));
    expect(action?.scopes).not.toContain(scopes.organization(workspace.organizationId));
  });

  it('never notifies the author about their own mention', async () => {
    const issue = await newIssue();
    const { actions } = await createComment(grace.principal, issue.id, {
      body: `Note to self @${grace.user.handle}`,
    });
    expect(await inboxOf(grace.user.id)).toHaveLength(0);
    expect(
      notificationActions(actions).filter((action) => action.data['userId'] === grace.user.id),
    ).toHaveLength(0);
  });

  it('sends one row, not two, when the mentioned person is also subscribed', async () => {
    const issue = await newIssue();
    await createComment(grace.principal, issue.id, { body: 'Looking now.' });

    await createComment(workspace.admin, issue.id, {
      body: `Thanks @${grace.user.handle}`,
    });

    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('mention');
  });

  it('never notifies someone who cannot see the team the issue lives on', async () => {
    const outsider = await addMember(workspace, 'member', { name: 'Bystander', teamIds: [] });
    const issue = await newIssue();
    await createComment(workspace.admin, issue.id, {
      body: `Ping @${outsider.user.handle}`,
    });
    expect(await inboxOf(outsider.user.id)).toHaveLength(0);
  });
});

describe('replies', () => {
  it('notifies the author of the comment that was replied to', async () => {
    const issue = await newIssue();
    const root = await createComment(grace.principal, issue.id, { body: 'Root comment.' });

    await createComment(workspace.admin, issue.id, {
      body: 'Answering that.',
      parentId: root.comment.id,
    });

    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('comment_replied');
    expect(rows[0]?.reason).toBe('commented');
  });

  it('notifies everyone already in the thread, not only the root author', async () => {
    const issue = await newIssue();
    const root = await createComment(grace.principal, issue.id, { body: 'Root comment.' });
    await createComment(linus.principal, issue.id, {
      body: 'Same here.',
      parentId: root.comment.id,
    });

    const latest = await createComment(workspace.admin, issue.id, {
      body: 'Fixed on main.',
      parentId: root.comment.id,
    });

    expect(await rowsAbout(grace.user.id, latest.comment.id)).toEqual([
      { type: 'comment_replied', reason: 'commented' },
    ]);
    expect(await rowsAbout(linus.user.id, latest.comment.id)).toEqual([
      { type: 'comment_replied', reason: 'commented' },
    ]);
  });

  it('notifies a subscriber who is not in the thread with a plain comment notification', async () => {
    const issue = await newIssue();
    await createComment(linus.principal, issue.id, { body: 'Watching this.' });
    const root = await createComment(grace.principal, issue.id, { body: 'Root comment.' });

    const latest = await createComment(workspace.admin, issue.id, {
      body: 'Reply in the thread.',
      parentId: root.comment.id,
    });

    expect(await rowsAbout(linus.user.id, latest.comment.id)).toEqual([
      { type: 'comment_created', reason: 'subscribed' },
    ]);
  });
});

describe('mentions in an issue description', () => {
  it('notifies on create', async () => {
    const issue = await newIssue('Ship the hub', `Owner is @${grace.user.handle}`);
    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('mention');
    expect(rows[0]?.url).toBe(`/issue/${issue.identifier}`);
  });

  it('notifies only the handles an edit introduced', async () => {
    const issue = await newIssue('Ship the hub', `Owner is @${grace.user.handle}`);
    await updateIssue(workspace.admin, issue.id, {
      description: `Owner is @${grace.user.handle} with @${linus.user.handle}`,
    });

    expect(await inboxOf(grace.user.id)).toHaveLength(1);
    const linusRows = await inboxOf(linus.user.id);
    expect(linusRows).toHaveLength(1);
    expect(linusRows[0]?.type).toBe('mention');
  });
});

describe('assignment and status', () => {
  it('notifies the assignee when the issue is created', async () => {
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Ship the hub',
      assigneeId: grace.user.id,
    });
    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('issue_assigned');
    expect(rows[0]?.reason).toBe('assigned');
    expect(rows[0]?.url).toBe(`/issue/${issue.identifier}`);
  });

  it('prefers the assignment over the mention when one edit does both', async () => {
    const issue = await newIssue();
    await updateIssue(workspace.admin, issue.id, {
      assigneeId: grace.user.id,
      description: `Over to you @${grace.user.handle}`,
    });
    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('issue_assigned');
  });

  it('notifies subscribers when the status changes and never the person who changed it', async () => {
    const issue = await newIssue();
    await createComment(grace.principal, issue.id, { body: 'Subscribing.' });
    const started = workspace.states.find((state) => state.category === 'started');

    await updateIssue(workspace.admin, issue.id, { stateId: started?.id });

    const rows = (await inboxOf(grace.user.id)).filter(
      (row) => row.type === 'issue_status_changed',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('state_changed');
    expect(
      (await inboxOf(workspace.admin.userId)).filter((row) => row.type === 'issue_status_changed'),
    ).toHaveLength(0);
  });
});

describe('docs', () => {
  it('notifies a mentioned teammate on doc creation', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Runbook',
      content: `Owner @${grace.user.handle}`,
    });
    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('mention');
    expect(rows[0]?.entityType).toBe('doc');
    expect(rows[0]?.url).toBe(`/docs/${doc.id}`);
  });

  it('does not notify the same person again when a later save keeps the mention', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Runbook',
      content: `Owner @${grace.user.handle}`,
    });
    await ageNotifications(grace.user.id);

    await updateDoc(workspace.admin, doc.id, {
      content: `Owner @${grace.user.handle}\n\nMore detail.`,
    });

    expect(await inboxOf(grace.user.id)).toHaveLength(1);
  });

  it('notifies a handle a later save introduces, long after the first one', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Runbook',
      content: `Owner @${grace.user.handle}`,
    });
    await ageNotifications(grace.user.id);

    await updateDoc(workspace.admin, doc.id, {
      content: `Owner @${grace.user.handle} with @${linus.user.handle}`,
    });

    expect(await inboxOf(grace.user.id)).toHaveLength(1);
    expect(await inboxOf(linus.user.id)).toHaveLength(1);
  });

  it('notifies a mentioned teammate on a doc comment and deep links to it', async () => {
    const { doc } = await createDoc(workspace.admin, { title: 'Runbook', content: '# Runbook' });
    const { comment } = await createDocComment(workspace.admin, doc.id, {
      body: `What do you think @${grace.user.handle}?`,
    });
    const rows = await inboxOf(grace.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('mention');
    expect(rows[0]?.url).toBe(`/docs/${doc.id}#doc-comment-${comment.id}`);
  });

  it('notifies the author of a doc comment that was replied to', async () => {
    const { doc } = await createDoc(workspace.admin, { title: 'Runbook', content: '# Runbook' });
    const root = await createDocComment(grace.principal, doc.id, { body: 'First thought.' });

    await createDocComment(linus.principal, doc.id, {
      body: 'Agreed.',
      parentId: root.comment.id,
    });

    const rows = (await inboxOf(grace.user.id)).filter((row) => row.type === 'comment_replied');
    expect(rows).toHaveLength(1);
  });
});

describe('preferences', () => {
  it('writes nothing when the recipient turned every channel off for that type', async () => {
    for (const channel of ['inbox', 'email', 'slack', 'push']) {
      await db.insert(schema.notificationPreference).values({
        id: `${channel}-${grace.user.id}`,
        userId: grace.user.id,
        channel,
        type: 'mention',
        enabled: false,
      });
    }

    const issue = await newIssue();
    const { actions } = await createComment(workspace.admin, issue.id, {
      body: `Ping @${grace.user.handle}`,
    });

    expect(await inboxOf(grace.user.id)).toHaveLength(0);
    expect(notificationActions(actions)).toHaveLength(0);
  });

  it('keeps notifying a type the recipient left enabled', async () => {
    await db.insert(schema.notificationPreference).values({
      id: `inbox-${grace.user.id}`,
      userId: grace.user.id,
      channel: 'inbox',
      type: 'comment_created',
      enabled: false,
    });

    const issue = await newIssue();
    await createComment(workspace.admin, issue.id, { body: `Ping @${grace.user.handle}` });
    expect(await inboxOf(grace.user.id)).toHaveLength(1);
  });
});
