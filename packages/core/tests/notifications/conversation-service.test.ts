import { beforeEach, describe, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { notifyMany, runNotificationConversationBackfill } from '@orbit/services/notifications';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { createComment } from '../../src/content/comment-service.ts';
import { createDocComment } from '../../src/content/doc-comment-service.ts';
import { createDoc, setDocAccess, updateDoc } from '../../src/content/doc-service.ts';
import {
  dismissInboxConversation,
  getInboxConversation,
  listInboxConversationEvents,
  listInboxConversations,
  markAllInboxConversationsRead,
  markInboxConversationsRead,
  snoozeInboxConversation,
} from '../../src/notifications/conversation-service.ts';
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
  workspace = await createWorkspace('Inbox');
});

async function fixture() {
  const recipient = await addMember(workspace, 'member', { name: 'Reader' });
  const { doc } = await createDoc(workspace.admin, {
    title: 'Release notes',
    content: 'Changes',
    visibility: 'workspace',
  });
  return { recipient, doc };
}

async function emit(
  docId: string,
  userId: string,
  sequence: number,
  type: 'mention' | 'document_changed' = 'document_changed',
) {
  return await notifyMany(db, [
    {
      organizationId: workspace.organizationId,
      type,
      reason: type === 'mention' ? 'mentioned' : 'subscribed',
      actor: { type: 'user', id: workspace.admin.userId, name: 'Admin' },
      entityType: 'doc',
      entityId: docId,
      userIds: [userId],
      title: `Document update ${sequence}`,
      body: `Content ${sequence}`,
      url: `/docs/${docId}`,
      source: {
        sourceEventKey: `doc-event:${docId}:${sequence}`,
        subjectType: 'doc',
        subjectKey: `orbit-doc:${docId}:activity`,
        occurredAt: new Date(1_700_000_000_000 + sequence),
        payload: { documentId: docId },
      },
    },
  ]);
}

describe('conversation inbox', () => {
  it('opens historical issue comments and denies history after team access is revoked', async () => {
    const recipient = await addMember(workspace, 'member', { name: 'Reader' });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Historical discussion',
    });
    const { comment } = await createComment(workspace.admin, issue.id, { body: 'Old comment' });
    const notificationId = randomUUIDv7();
    await db.insert(schema.notification).values({
      id: notificationId,
      organizationId: workspace.organizationId,
      userId: recipient.user.id,
      actorId: workspace.admin.userId,
      actorName: 'Admin',
      type: 'comment_added',
      entityType: 'comment',
      entityId: comment.id,
      title: 'Historical issue comment',
      url: `/issues/${issue.id}`,
      deliveredChannels: ['inbox'],
    });
    await runNotificationConversationBackfill(db, {
      organizationIds: [workspace.organizationId],
    });
    const page = await listInboxConversations(recipient.principal);
    const conversation = page.conversations.find((row) => row.subjectId === notificationId);
    expect(
      page.conversations.map((row) => ({ id: row.subjectId, type: row.subjectType })),
    ).toContainEqual({ id: notificationId, type: 'legacy_notification' });
    const conversationId = conversation?.id ?? '';
    const history = await listInboxConversationEvents(recipient.principal, conversationId);
    expect(history.events[0]?.title).toBe('Historical issue comment');
    await expect(getInboxConversation(workspace.admin, conversationId)).rejects.toThrow();
    await db
      .delete(schema.teamMember)
      .where(
        and(
          eq(schema.teamMember.teamId, workspace.teamId),
          eq(schema.teamMember.userId, recipient.user.id),
        ),
      );
    await expect(
      listInboxConversationEvents(recipient.principal, conversationId),
    ).rejects.toThrow();
    expect((await listInboxConversations(recipient.principal)).conversations).toHaveLength(0);
  });

  it('groups events, filters mentions before pagination, and returns ordered history', async () => {
    const { recipient, doc } = await fixture();
    await emit(doc.id, recipient.user.id, 1, 'mention');
    await emit(doc.id, recipient.user.id, 2);
    const { doc: other } = await createDoc(workspace.admin, {
      title: 'Another document',
      visibility: 'workspace',
    });
    await emit(other.id, recipient.user.id, 3);
    const page = await listInboxConversations(recipient.principal, { tab: 'mentions', limit: 1 });
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]?.subjectId).toBe(doc.id);
    expect(page.conversations[0]?.eventCount).toBe(2);
    expect(page.counters.unreadCount).toBe(2);
    expect(page.counters.unreadMentionCount).toBe(1);
    const id = page.conversations[0]?.id ?? '';
    const history = await listInboxConversationEvents(recipient.principal, id, { limit: 1 });
    expect(history.events[0]?.title).toBe('Document update 2');
    expect(history.nextCursor).not.toBeNull();
    const older = await listInboxConversationEvents(recipient.principal, id, {
      cursor: history.nextCursor,
    });
    expect(older.events[0]?.title).toBe('Document update 1');
  });

  it('uses manual unread without inventing events or mentions and keeps legacy rows compatible', async () => {
    const { recipient, doc } = await fixture();
    await emit(doc.id, recipient.user.id, 1, 'mention');
    await emit(doc.id, recipient.user.id, 2);
    const id = (await listInboxConversations(recipient.principal)).conversations[0]?.id ?? '';
    const read = await markInboxConversationsRead(recipient.principal, {
      conversationIds: [id],
      read: true,
    });
    expect(read.counters.unreadCount).toBe(0);
    const unread = await markInboxConversationsRead(recipient.principal, {
      conversationIds: [id],
      read: false,
    });
    expect(unread.counters).toEqual({
      unreadCount: 1,
      unreadActivityCount: 1,
      unreadMentionCount: 0,
    });
    expect(unread.conversations[0]?.unreadEventCount).toBe(0);
    const siblings = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.conversationId, id));
    expect(siblings.filter((row) => row.manualUnreadAnchor)).toHaveLength(1);
    expect(siblings.filter((row) => row.readAt === null)).toHaveLength(1);
    expect(unread.actions[0]?.data).not.toHaveProperty('title');
    expect(unread.actions[0]?.data).not.toHaveProperty('body');
  });

  it('snoozes and dismisses the complete conversation and new activity resurfaces it', async () => {
    const { recipient, doc } = await fixture();
    await emit(doc.id, recipient.user.id, 1);
    const id = (await listInboxConversations(recipient.principal)).conversations[0]?.id ?? '';
    const snoozed = await snoozeInboxConversation(recipient.principal, id, {
      snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(snoozed.counters.unreadCount).toBe(0);
    expect((await listInboxConversations(recipient.principal)).conversations).toHaveLength(0);
    await snoozeInboxConversation(recipient.principal, id, { snoozedUntil: null });
    expect((await listInboxConversations(recipient.principal)).conversations).toHaveLength(1);
    await dismissInboxConversation(recipient.principal, id);
    expect((await listInboxConversations(recipient.principal)).conversations).toHaveLength(0);
    await emit(doc.id, recipient.user.id, 2);
    expect((await listInboxConversations(recipient.principal)).conversations[0]?.eventCount).toBe(
      2,
    );
    await markAllInboxConversationsRead(recipient.principal);
    expect((await listInboxConversations(recipient.principal)).counters.unreadCount).toBe(0);
  });

  it('rechecks document access and prevents cross-user history or mutations', async () => {
    const { recipient, doc } = await fixture();
    await emit(doc.id, recipient.user.id, 1);
    const id = (await listInboxConversations(recipient.principal)).conversations[0]?.id ?? '';
    await expect(getInboxConversation(workspace.admin, id)).rejects.toThrow();
    await updateDoc(workspace.admin, doc.id, { visibility: 'private' });
    expect((await listInboxConversations(recipient.principal)).conversations).toHaveLength(0);
    await expect(listInboxConversationEvents(recipient.principal, id)).rejects.toThrow();
    await expect(
      markInboxConversationsRead(recipient.principal, { conversationIds: [id], read: true }),
    ).rejects.toThrow();
    const [state] = await db
      .select()
      .from(schema.notificationInboxState)
      .where(
        and(
          eq(schema.notificationInboxState.organizationId, workspace.organizationId),
          eq(schema.notificationInboxState.userId, recipient.user.id),
        ),
      );
    expect(state?.unreadCount).toBe(0);
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: recipient.user.id, level: 'read' }],
    });
    expect((await listInboxConversations(recipient.principal)).conversations).toHaveLength(1);
  });

  it('groups actual doc comments, replies, and document edits with mentions', async () => {
    const { recipient, doc } = await fixture();
    const { comment } = await createDocComment(recipient.principal, doc.id, {
      body: 'Following this',
    });
    await createDocComment(workspace.admin, doc.id, {
      body: `@${recipient.user.handle} a reply`,
      parentId: comment.id,
    });
    await updateDoc(workspace.admin, doc.id, { content: 'Updated content' });
    await updateDoc(workspace.admin, doc.id, { content: 'Updated content again' });
    const page = await listInboxConversations(recipient.principal);
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]?.conversationKey).toBe(`orbit-doc:${doc.id}:activity`);
    expect(page.conversations[0]?.eventCount).toBe(2);
  });

  it('rejects malformed cursors', async () => {
    await expect(
      listInboxConversations(workspace.admin, { cursor: 'not-a-cursor' }),
    ).rejects.toThrow('cursor');
  });
});
