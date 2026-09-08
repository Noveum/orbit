import { and, type Database, eq, inArray, isNull, or, schema, type Transaction } from '@orbit/db';
import { isExternallyShared } from '@orbit/shared/constants';
import { notFound } from '@orbit/shared/errors';
import { assertCan, canReadDoc, canWriteDoc, isInTeam, type Principal } from '@orbit/shared/policy';
import type { SQL } from 'drizzle-orm';

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
    .innerJoin(schema.organization, eq(schema.organization.id, schema.doc.organizationId))
    .where(
      and(
        eq(schema.doc.id, docId),
        eq(schema.doc.organizationId, organizationId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  return row;
}

interface DocAccessRow {
  readonly organizationId: string;
  readonly id: string;
  readonly visibility: string;
  readonly authorId: string;
  readonly archivedAt: Date | null;
}

function subjectMatches(executor: StorageExecutor, principal: Principal): SQL | undefined {
  return or(
    and(eq(schema.docAccess.subjectType, 'user'), eq(schema.docAccess.subjectId, principal.userId)),
    and(
      eq(schema.docAccess.subjectType, 'team'),
      inArray(
        schema.docAccess.subjectId,
        executor
          .select({ teamId: schema.teamMember.teamId })
          .from(schema.teamMember)
          .where(eq(schema.teamMember.userId, principal.userId)),
      ),
    ),
  );
}

async function docAllowing(
  executor: StorageExecutor,
  principal: Principal,
  docId: string,
  level: 'read' | 'write',
): Promise<DocAccessRow | undefined> {
  const [row] = await executor
    .select({
      id: schema.doc.id,
      organizationId: schema.doc.organizationId,
      visibility: schema.doc.visibility,
      authorId: schema.doc.authorId,
      archivedAt: schema.doc.archivedAt,
    })
    .from(schema.doc)
    .where(and(eq(schema.doc.id, docId), eq(schema.doc.organizationId, principal.organizationId)))
    .limit(1);
  if (row === undefined) return undefined;
  const grants = await executor
    .select({ docId: schema.docAccess.docId })
    .from(schema.docAccess)
    .where(
      and(
        eq(schema.docAccess.docId, docId),
        level === 'write' ? eq(schema.docAccess.level, 'write') : undefined,
        subjectMatches(executor, principal),
      ),
    )
    .limit(1);
  const allowed =
    level === 'read'
      ? canReadDoc(
          principal,
          row,
          grants.map((grant) => grant.docId),
        )
      : canWriteDoc(principal, row, grants.length > 0);
  return allowed ? row : undefined;
}

async function docReadableBy(
  executor: StorageExecutor,
  principal: Principal,
  docId: string,
): Promise<DocAccessRow | undefined> {
  return await docAllowing(executor, principal, docId, 'read');
}

async function docWritableBy(
  executor: StorageExecutor,
  principal: Principal,
  docId: string,
): Promise<DocAccessRow | undefined> {
  return await docAllowing(executor, principal, docId, 'write');
}

async function teamsOwning(
  executor: StorageExecutor,
  parentType: Exclude<AttachmentParentType, 'doc'>,
  parentId: string,
  organizationId: string,
): Promise<string[] | null> {
  if (parentType === 'issue') {
    const [row] = await executor
      .select({ teamId: schema.issue.teamId })
      .from(schema.issue)
      .where(and(eq(schema.issue.id, parentId), eq(schema.issue.organizationId, organizationId)))
      .limit(1);
    return row === undefined ? null : [row.teamId];
  }
  if (parentType === 'comment') {
    const [row] = await executor
      .select({ teamId: schema.issue.teamId })
      .from(schema.comment)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.comment.issueId))
      .where(
        and(eq(schema.comment.id, parentId), eq(schema.comment.organizationId, organizationId)),
      )
      .limit(1);
    return row === undefined ? null : [row.teamId];
  }
  const [project] = await executor
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(and(eq(schema.project.id, parentId), eq(schema.project.organizationId, organizationId)))
    .limit(1);
  if (project === undefined) return null;
  const teams = await executor
    .select({ teamId: schema.projectTeam.teamId })
    .from(schema.projectTeam)
    .where(eq(schema.projectTeam.projectId, parentId));
  return teams.map((row) => row.teamId);
}

function seesEveryTeam(principal: Principal): boolean {
  return principal.role === 'admin';
}

function sharesATeam(principal: Principal, teamIds: readonly string[]): boolean {
  if (seesEveryTeam(principal)) return true;
  if (teamIds.length === 0) return true;
  return teamIds.some((teamId) =>
    isInTeam(principal, { id: teamId, organizationId: principal.organizationId }),
  );
}

export async function assertUploadParent(
  executor: StorageExecutor,
  principal: Principal,
  parentType: AttachmentParentType,
  parentId: string,
): Promise<void> {
  assertCan(principal, 'attachment:upload');

  if (parentType === 'doc') {
    assertCan(principal, 'doc:write');
    const row = await docWritableBy(executor, principal, parentId);
    if (row === undefined || row.archivedAt !== null) {
      throw notFound('That doc does not exist.');
    }
    if (isExternallyShared(row.visibility)) assertCan(principal, 'doc:publish');
    return;
  }

  const teamIds = await teamsOwning(executor, parentType, parentId, principal.organizationId);
  if (teamIds === null || !sharesATeam(principal, teamIds)) {
    throw notFound(`That ${parentType} does not exist.`);
  }
}

export async function assertAttachmentVisible(
  executor: StorageExecutor,
  principal: Principal,
  attachment: AttachmentOwner,
): Promise<void> {
  if (attachment.organizationId !== principal.organizationId) {
    throw notFound('That file does not exist.');
  }
  if (attachment.parentType === 'doc') {
    assertCan(principal, 'doc:read');
    const row = await docReadableBy(executor, principal, attachment.parentId);
    if (row === undefined) throw notFound('That file does not exist.');
    return;
  }
  if (!isAttachmentParentType(attachment.parentType)) {
    throw notFound('That file does not exist.');
  }
  const teamIds = await teamsOwning(
    executor,
    attachment.parentType,
    attachment.parentId,
    attachment.organizationId,
  );
  if (teamIds === null || !sharesATeam(principal, teamIds)) {
    throw notFound('That file does not exist.');
  }
}

function isAttachmentParentType(value: string): value is Exclude<AttachmentParentType, 'doc'> {
  return value === 'issue' || value === 'comment' || value === 'project';
}

export async function isPubliclyReadable(
  executor: StorageExecutor,
  attachment: AttachmentOwner,
): Promise<boolean> {
  if (attachment.parentType !== 'doc') return false;
  const row = await docFor(executor, attachment.organizationId, attachment.parentId);
  return row !== undefined && row.archivedAt === null && isExternallyShared(row.visibility);
}
