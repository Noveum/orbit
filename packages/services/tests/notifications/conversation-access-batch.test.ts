import { expect, it } from 'bun:test';
import { and, db, eq, pool, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { drizzle } from 'drizzle-orm/postgres-js';
import { refreshNotificationConversationAccess } from '../../src/notifications/conversation-access.ts';

it('refreshes many direct, comment, and legacy subjects with a fixed query budget', async () => {
  const organizationId = randomUUIDv7();
  const userId = randomUUIDv7();
  const authorId = randomUUIDv7();
  await db.insert(schema.user).values(
    [userId, authorId].map((id) => ({
      id,
      name: 'Reader',
      email: `${id}@example.com`,
      handle: id,
    })),
  );
  await db
    .insert(schema.organization)
    .values({ id: organizationId, name: 'Batch', slug: organizationId });
  await db
    .insert(schema.member)
    .values({ id: randomUUIDv7(), organizationId, userId, role: 'member' });
  try {
    const docs = Array.from({ length: 24 }, (_, index) => ({
      id: randomUUIDv7(),
      organizationId,
      authorId,
      title: `Document ${index}`,
      visibility: index % 4 === 0 ? 'private' : 'workspace',
    }));
    await db.insert(schema.doc).values(docs);
    const comments = docs.map((doc) => ({
      id: randomUUIDv7(),
      organizationId,
      authorId,
      docId: doc.id,
      body: 'Comment',
    }));
    await db.insert(schema.docComment).values(comments);
    const notifications = comments.map((comment) => ({
      id: randomUUIDv7(),
      organizationId,
      userId,
      actorId: authorId,
      actorName: 'Author',
      type: 'comment_added',
      entityType: 'doc_comment',
      entityId: comment.id,
      title: 'Comment',
      url: `/docs/${comment.docId}`,
    }));
    await db.insert(schema.notification).values(notifications);
    const subjects = [
      ...docs.map((doc) => ({ subjectType: 'doc', subjectId: doc.id })),
      ...comments.map((comment) => ({ subjectType: 'doc_comment', subjectId: comment.id })),
      ...notifications.map((notification) => ({
        subjectType: 'legacy_notification',
        subjectId: notification.id,
      })),
      { subjectType: 'doc', subjectId: randomUUIDv7() },
      { subjectType: 'unknown', subjectId: randomUUIDv7() },
    ];
    await db.insert(schema.notificationConversation).values(
      subjects.map((subject) => ({
        id: randomUUIDv7(),
        organizationId,
        userId,
        ...subject,
        conversationKey: `${subject.subjectType}:${subject.subjectId}`,
        category: 'activity',
        eventCount: 1,
        unreadEventCount: 1,
      })),
    );
    const queries: string[] = [];
    const counted = drizzle({
      client: pool,
      schema,
      casing: 'snake_case',
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    const changed = await counted.transaction(
      async (tx) => await refreshNotificationConversationAccess(tx, organizationId, userId),
    );
    expect(changed).toHaveLength(20);
    expect(queries.length).toBeLessThanOrEqual(18);
    const [state] = await db
      .select()
      .from(schema.notificationInboxState)
      .where(
        and(
          eq(schema.notificationInboxState.organizationId, organizationId),
          eq(schema.notificationInboxState.userId, userId),
        ),
      );
    expect(state?.unreadCount).toBe(54);
    await db.update(schema.member).set({ role: 'admin' }).where(eq(schema.member.userId, userId));
    queries.length = 0;
    const revealed = await counted.transaction(
      async (tx) => await refreshNotificationConversationAccess(tx, organizationId, userId),
    );
    expect(revealed).toHaveLength(18);
    expect(queries.length).toBeLessThanOrEqual(18);
    await db.delete(schema.member).where(eq(schema.member.userId, userId));
    const hidden = await counted.transaction(
      async (tx) => await refreshNotificationConversationAccess(tx, organizationId, userId),
    );
    expect(hidden).toHaveLength(72);
  } finally {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.delete(schema.user).where(eq(schema.user.id, authorId));
  }
});
