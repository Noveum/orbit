import { beforeEach, expect, it } from 'bun:test';
import { and, db, eq, schema } from '@orbit/db';
import { createComment } from '../../src/content/comment-service.ts';
import { createDocComment } from '../../src/content/doc-comment-service.ts';
import { createDoc } from '../../src/content/doc-service.ts';
import { addMember, createWorkspace, resetDatabase } from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

beforeEach(resetDatabase);

it('keeps maximum-length issue and document titles intact when comments notify their subscribers', async () => {
  const workspace = await createWorkspace('Titlelimits');
  const author = await addMember(workspace, 'member', { name: 'Commenter' });
  const issueTitle = 'I'.repeat(255);
  const docTitle = 'D'.repeat(200);
  const { issue } = await createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title: issueTitle,
  });
  const { doc } = await createDoc(workspace.admin, {
    title: docTitle,
    content: '# Document',
    visibility: 'workspace',
  });
  const { comment: issueComment } = await createComment(author.principal, issue.id, {
    body: 'Issue update',
  });
  const { comment } = await createDocComment(author.principal, doc.id, { body: 'Document update' });
  const notifications = await db
    .select()
    .from(schema.notification)
    .where(
      and(
        eq(schema.notification.organizationId, workspace.organizationId),
        eq(schema.notification.userId, workspace.admin.userId),
      ),
    );
  const issueEvent = notifications.find((event) => event.entityId === issueComment.id);
  const docEvent = notifications.find((event) => event.entityId === comment.id);
  expect(issueEvent?.title).toBe(`New comment on ${issue.identifier}`);
  expect(docEvent?.title).toBe(`New comment on ${docTitle}`);
  expect(docEvent?.url).toContain(doc.id);
  expect(docEvent?.url).toContain(comment.id);
  const [storedIssue] = await db.select().from(schema.issue).where(eq(schema.issue.id, issue.id));
  const [storedDoc] = await db.select().from(schema.doc).where(eq(schema.doc.id, doc.id));
  expect(storedIssue?.title).toBe(issueTitle);
  expect(storedDoc?.title).toBe(docTitle);
});
