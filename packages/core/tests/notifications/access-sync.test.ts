import { beforeEach, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { createComment } from '../../src/content/comment-service.ts';
import { createDocComment } from '../../src/content/doc-comment-service.ts';
import { createDoc, setDocAccess, shareDoc } from '../../src/content/doc-service.ts';
import { removeMember } from '../../src/org/member-service.ts';
import { addTeamMember, removeTeamMember } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;
let reader: Awaited<ReturnType<typeof addMember>>;
beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  reader = await addMember(workspace, 'member', { name: 'Reader' });
});

async function notificationState() {
  const [conversation] = await db
    .select()
    .from(schema.notificationConversation)
    .where(eq(schema.notificationConversation.userId, reader.user.id));
  const [state] = await db
    .select()
    .from(schema.notificationInboxState)
    .where(eq(schema.notificationInboxState.userId, reader.user.id));
  return { conversation, state };
}

it('revokes and restores team notification visibility and invalidates queued mail atomically', async () => {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Discuss access',
  });
  await createComment(workspace.admin, issue.id, { body: `Please review @${reader.user.handle}` });
  const [event] = await db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.userId, reader.user.id));
  if (event === undefined || event.sourceEventId === null)
    throw new Error('Expected recipient source.');
  const deliveryId = randomUUIDv7();
  await db
    .insert(schema.notificationDelivery)
    .values({
      id: deliveryId,
      organizationId: workspace.organizationId,
      notificationId: event.id,
      userId: reader.user.id,
      sourceEventId: event.sourceEventId,
      channel: 'email',
      destinationKind: 'user',
      destinationId: reader.user.id,
      status: 'pending',
    })
    .onConflictDoNothing();
  const actions = await removeTeamMember(workspace.admin, workspace.teamId, reader.user.id);
  const hidden = await notificationState();
  expect(hidden.conversation?.accessHiddenAt).not.toBeNull();
  expect(hidden.state?.unreadCount).toBe(0);
  expect(
    actions.find((action) => action.model === 'notification_conversation')?.data['visible'],
  ).toBe(false);
  const [delivery] = await db
    .select()
    .from(schema.notificationDelivery)
    .where(
      and(
        eq(schema.notificationDelivery.notificationId, event.id),
        eq(schema.notificationDelivery.channel, 'email'),
      ),
    );
  expect(delivery?.status).toBe('unavailable');
  const restored = await addTeamMember(workspace.admin, workspace.teamId, {
    userId: reader.user.id,
  });
  const visible = await notificationState();
  expect(visible.conversation?.accessHiddenAt).toBeNull();
  expect(visible.state?.unreadCount).toBe(1);
  expect(
    restored.actions.find((action) => action.model === 'notification_conversation')?.data[
      'visible'
    ],
  ).toBe(true);
});

it('updates document notification access in the same share and grant transactions', async () => {
  const { doc } = await createDoc(workspace.admin, {
    title: 'Decision record',
    visibility: 'workspace',
  });
  await createDocComment(workspace.admin, doc.id, { body: `Review this @${reader.user.handle}` });
  const hidden = await shareDoc(workspace.admin, doc.id, { visibility: 'private' });
  expect((await notificationState()).state?.unreadCount).toBe(0);
  expect(
    hidden.actions.some(
      (action) => action.model === 'notification_conversation' && action.data['visible'] === false,
    ),
  ).toBe(true);
  const shown = await setDocAccess(workspace.admin, doc.id, {
    grants: [{ subjectType: 'user', subjectId: reader.user.id, level: 'read' }],
  });
  expect((await notificationState()).state?.unreadCount).toBe(1);
  expect(
    shown.actions.some(
      (action) => action.model === 'notification_conversation' && action.data['visible'] === true,
    ),
  ).toBe(true);
});

it('workspace removal hides retained inbox history before committing', async () => {
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: 'Member access',
  });
  await createComment(workspace.admin, issue.id, { body: `Review @${reader.user.handle}` });
  const [membership] = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, reader.user.id));
  if (membership === undefined) throw new Error('Expected membership.');
  const result = await removeMember(workspace.admin, membership.id);
  expect((await notificationState()).state?.unreadCount).toBe(0);
  expect((await notificationState()).conversation?.accessHiddenAt).not.toBeNull();
  expect(
    result.actions.some(
      (action) => action.model === 'notification_conversation' && action.data['visible'] === false,
    ),
  ).toBe(true);
});
