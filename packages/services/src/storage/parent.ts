import { and, type Database, eq, schema, type Transaction } from '@orbit/db';
import { notFound } from '@orbit/shared/errors';
import { assertCan, type Principal } from '@orbit/shared/policy';

export type StorageExecutor = Database | Transaction;

export type AttachmentParentType = 'issue' | 'comment' | 'doc' | 'project';

export interface AttachmentOwner {
  readonly organizationId: string;
  readonly parentType: string;
  readonly parentId: string;
}

interface DocVisibility {
  readonly visibility: string;
  readonly archivedAt: Date | null;
}

async function docFor(
  executor: StorageExecutor,
  organizationId: string,
  docId: string,
): Promise<DocVisibility | undefined> {
  const [row] = await executor
    .select({ visibility: schema.doc.visibility, archivedAt: schema.doc.archivedAt })
    .from(schema.doc)
    .where(and(eq(schema.doc.id, docId), eq(schema.doc.organizationId, organizationId)))
    .limit(1);
  return row;
}

async function existsInOrganization(
  executor: StorageExecutor,
  parentType: Exclude<AttachmentParentType, 'doc'>,
  parentId: string,
  organizationId: string,
): Promise<boolean> {
  if (parentType === 'issue') {
    const [row] = await executor
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .where(and(eq(schema.issue.id, parentId), eq(schema.issue.organizationId, organizationId)))
      .limit(1);
    return row !== undefined;
  }
  if (parentType === 'comment') {
    const [row] = await executor
      .select({ id: schema.comment.id })
      .from(schema.comment)
      .where(
        and(eq(schema.comment.id, parentId), eq(schema.comment.organizationId, organizationId)),
      )
      .limit(1);
    return row !== undefined;
  }
  const [row] = await executor
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(and(eq(schema.project.id, parentId), eq(schema.project.organizationId, organizationId)))
    .limit(1);
  return row !== undefined;
}

export async function assertUploadParent(
  executor: StorageExecutor,
  principal: Principal,
  parentType: AttachmentParentType,
  parentId: string,
): Promise<void> {
  assertCan(principal, 'attachment:upload');

  if (parentType === 'doc') {
    const row = await docFor(executor, principal.organizationId, parentId);
    if (row === undefined || row.archivedAt !== null) {
      throw notFound('That doc does not exist.');
    }
    assertCan(principal, 'doc:write');
    if (row.visibility !== 'workspace') assertCan(principal, 'doc:publish');
    return;
  }

  if (!(await existsInOrganization(executor, parentType, parentId, principal.organizationId))) {
    throw notFound(`That ${parentType} does not exist.`);
  }
}

export async function isPubliclyReadable(
  executor: StorageExecutor,
  attachment: AttachmentOwner,
): Promise<boolean> {
  if (attachment.parentType !== 'doc') return false;
  const row = await docFor(executor, attachment.organizationId, attachment.parentId);
  return row !== undefined && row.archivedAt === null && row.visibility !== 'workspace';
}
