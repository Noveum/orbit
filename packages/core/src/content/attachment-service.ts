import { and, asc, db, eq, inArray, isNull, schema, type Transaction } from '@orbit/db';
import {
  assertUploadParent,
  fileUrlFor,
  type StorageDriver,
  storageDriver,
  storageKeyFor,
  type UploadTarget,
  validateUpload,
} from '@orbit/services/storage';
import { conflict, notFound, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam, teamScope } from '@orbit/shared/policy';
import { inlineUploadSchema, uploadRequestSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow } from '../internal.ts';
import { lockOrganization } from '../org/organization-lock.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { getProject } from '../work/project-service.ts';
import { loadReadableDoc } from './doc-service.ts';

export type AttachmentRecord = typeof schema.attachment.$inferSelect;

export function attachmentScopes(
  row: Pick<AttachmentRecord, 'parentType' | 'parentId' | 'uploadedById'>,
): string[] {
  if (row.parentType === 'doc') return [scopes.doc(row.parentId)];
  if (row.parentType === 'issue') return [scopes.issue(row.parentId)];
  if (row.parentType === 'project') return [scopes.project(row.parentId)];
  return [scopes.user(row.uploadedById)];
}

export async function resolveAttachmentScopes(
  executor: Executor,
  row: Pick<AttachmentRecord, 'parentType' | 'parentId' | 'uploadedById'>,
  organizationId: string,
): Promise<string[]> {
  if (row.parentType !== 'comment') return attachmentScopes(row);
  const [comment] = await executor
    .select({ issueId: schema.comment.issueId })
    .from(schema.comment)
    .where(
      and(eq(schema.comment.id, row.parentId), eq(schema.comment.organizationId, organizationId)),
    )
    .limit(1);
  if (comment === undefined) return [scopes.user(row.uploadedById)];
  return [scopes.issue(comment.issueId)];
}

export interface CompletedAttachment {
  readonly attachment: AttachmentRecord;
  readonly actions: SyncAction[];
}

export async function findAttachmentForOrganization(
  principal: Principal,
  id: string,
): Promise<AttachmentRecord> {
  const [record] = await db
    .select()
    .from(schema.attachment)
    .where(
      and(
        eq(schema.attachment.id, id),
        eq(schema.attachment.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  if (record === undefined) throw notFound('That upload was not registered.');
  return record;
}

export async function markAttachmentReady(
  principal: Principal,
  record: AttachmentRecord,
  storedSize: number,
): Promise<CompletedAttachment> {
  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const [updated] = await tx
      .update(schema.attachment)
      .set({ status: 'ready', size: storedSize, syncId })
      .where(eq(schema.attachment.id, record.id))
      .returning();
    if (updated === undefined) throw notFound('That upload was not registered.');

    const actor = await principalActor(tx, principal);

    return {
      attachment: updated,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: updated.organizationId,
          scopes: await resolveAttachmentScopes(tx, updated, updated.organizationId),
          action: 'update',
          model: 'attachment',
          modelId: updated.id,
          data: updated,
          actor,
        }),
      ],
    };
  });
}

interface AttachmentDraft {
  readonly parentType: string;
  readonly parentId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly storageKey: string;
  readonly status: 'pending' | 'ready';
  readonly uploadExpiresAt: Date | null;
}

async function insertAttachment(
  tx: Transaction,
  principal: Principal,
  draft: AttachmentDraft,
): Promise<CompletedAttachment> {
  const syncId = await nextSyncId(tx);
  const [created] = await tx
    .insert(schema.attachment)
    .values({
      id: newId(),
      organizationId: principal.organizationId,
      parentType: draft.parentType,
      parentId: draft.parentId,
      fileName: draft.fileName,
      contentType: draft.contentType,
      size: draft.size,
      storageKey: draft.storageKey,
      status: draft.status,
      uploadExpiresAt: draft.uploadExpiresAt,
      uploadedById: principal.userId,
      syncId,
    })
    .returning();
  const attachment = requireRow(created, 'That upload could not be registered.');
  const actor = await principalActor(tx, principal);

  return {
    attachment,
    actions: [
      buildSyncAction({
        syncId,
        organizationId: attachment.organizationId,
        scopes: await resolveAttachmentScopes(tx, attachment, attachment.organizationId),
        action: 'insert',
        model: 'attachment',
        modelId: attachment.id,
        data: attachment,
        actor,
      }),
    ],
  };
}

export interface RegisteredUpload extends CompletedAttachment {
  readonly upload: UploadTarget;
}

function assertOrganizationAcceptsFiles(
  organization: typeof schema.organization.$inferSelect,
): void {
  if (organization.deletionRequestedAt !== null) {
    throw conflict('Workspace deletion is in progress.');
  }
}

export async function registerUpload(
  principal: Principal,
  input: unknown,
  driver?: StorageDriver,
): Promise<RegisteredUpload> {
  const upload = validateUpload(input);
  const parsed = uploadRequestSchema.parse(input);
  const key = storageKeyFor(principal.organizationId, upload.safeName);
  return await db.transaction(async (tx) => {
    const organization = await lockOrganization(tx, principal.organizationId);
    assertOrganizationAcceptsFiles(organization);
    await assertUploadParent(tx, principal, parsed.parentType, parsed.parentId);
    const store = driver ?? storageDriver();
    const target = await store.createUploadTarget(key, upload.contentType, upload.size);
    const registered = await insertAttachment(tx, principal, {
      parentType: parsed.parentType,
      parentId: parsed.parentId,
      fileName: upload.fileName,
      contentType: upload.contentType,
      size: upload.size,
      storageKey: target.key,
      status: 'pending',
      uploadExpiresAt: new Date(target.expiresAt),
    });
    return { ...registered, upload: target };
  });
}

export async function finishUpload(
  principal: Principal,
  attachmentId: string,
  driver?: StorageDriver,
): Promise<CompletedAttachment> {
  const record = await findAttachmentForOrganization(principal, attachmentId);
  if (record.uploadedById !== principal.userId) {
    throw notFound('That upload was not registered.');
  }
  const stored = await (driver ?? storageDriver()).stat(record.storageKey);
  if (stored === null) throw notFound('That upload never reached storage.');
  if (stored.size > record.size) {
    throw validationFailed('That upload is larger than the registered size.');
  }
  return await markAttachmentReady(principal, record, stored.size);
}

export interface AttachedFile extends CompletedAttachment {
  readonly url: string;
}

export async function attachFile(
  principal: Principal,
  input: unknown,
  driver?: StorageDriver,
): Promise<AttachedFile> {
  const parsed = inlineUploadSchema.parse(input);
  const bytes = new Uint8Array(Buffer.from(parsed.content, 'base64'));
  const upload = validateUpload({
    fileName: parsed.fileName,
    contentType: parsed.contentType,
    size: bytes.byteLength,
  });
  const key = storageKeyFor(principal.organizationId, upload.safeName);
  let store: StorageDriver | null = driver ?? null;
  let objectStored = false;
  try {
    return await db.transaction(async (tx) => {
      const organization = await lockOrganization(tx, principal.organizationId);
      assertOrganizationAcceptsFiles(organization);
      await assertUploadParent(tx, principal, parsed.parentType, parsed.parentId);
      store ??= storageDriver();
      await store.put(key, bytes, upload.contentType);
      objectStored = true;
      const stored = await insertAttachment(tx, principal, {
        parentType: parsed.parentType,
        parentId: parsed.parentId,
        fileName: upload.fileName,
        contentType: upload.contentType,
        size: upload.size,
        storageKey: key,
        status: 'ready',
        uploadExpiresAt: null,
      });
      return { ...stored, url: fileUrlFor(key) };
    });
  } catch (error: unknown) {
    if (objectStored && store !== null) await store.delete(key).catch(() => undefined);
    throw error;
  }
}

export interface IssueAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly parentType: string;
  readonly parentId: string;
  readonly uploadedById: string;
  readonly createdAt: Date;
  readonly url: string;
}

async function requireReadableIssue(principal: Principal, issueId: string) {
  assertCan(principal, 'issue:read');
  const [issue] = await db
    .select({
      id: schema.issue.id,
      teamId: schema.issue.teamId,
      projectId: schema.issue.projectId,
      organizationId: schema.issue.organizationId,
    })
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.organizationId, principal.organizationId)),
    )
    .limit(1);
  const found = requireRow(issue, 'That issue does not exist.');
  assertInTeam(principal, teamScope(found));
  return found;
}

function toIssueAttachment(row: AttachmentRecord): IssueAttachment {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    parentType: row.parentType,
    parentId: row.parentId,
    uploadedById: row.uploadedById,
    createdAt: row.createdAt,
    url: fileUrlFor(row.storageKey),
  };
}

export async function listIssueAttachments(
  principal: Principal,
  issueId: string,
): Promise<IssueAttachment[]> {
  await requireReadableIssue(principal, issueId);
  const commentIds = await db
    .select({ id: schema.comment.id })
    .from(schema.comment)
    .where(and(eq(schema.comment.issueId, issueId), isNull(schema.comment.deletedAt)));
  const parents = [issueId, ...commentIds.map((row) => row.id)];
  const rows = await db
    .select()
    .from(schema.attachment)
    .where(
      and(
        eq(schema.attachment.organizationId, principal.organizationId),
        eq(schema.attachment.status, 'ready'),
        inArray(schema.attachment.parentId, parents),
      ),
    )
    .orderBy(asc(schema.attachment.createdAt));
  return rows
    .filter((row) => row.parentType === 'issue' || row.parentType === 'comment')
    .map(toIssueAttachment);
}

export interface AttachmentContent {
  readonly attachment: IssueAttachment;
  readonly encoding: 'utf8' | 'base64';
  readonly content: string;
  readonly truncated: boolean;
}

const TEXT_CONTENT_TYPES =
  /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|typescript|sql))/;

export function isTextualContentType(contentType: string): boolean {
  return TEXT_CONTENT_TYPES.test(contentType.toLowerCase());
}

async function assertAttachmentReadable(
  principal: Principal,
  record: AttachmentRecord,
): Promise<void> {
  if (record.parentType === 'issue') {
    await requireReadableIssue(principal, record.parentId);
    return;
  }
  if (record.parentType === 'comment') {
    const issueId = await commentIssueId(principal, record.parentId);
    if (issueId === null) throw notFound('That comment does not exist.');
    await requireReadableIssue(principal, issueId);
    return;
  }
  if (record.parentType === 'doc') {
    await loadReadableDoc(db, principal, record.parentId);
    return;
  }
  if (record.parentType === 'project') {
    await getProject(principal, record.parentId);
    return;
  }
  throw notFound('That file does not exist.');
}

function decodeWholeCharacters(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false })
    .decode(bytes.subarray(0, wholeCharacterLength(bytes)))
    .replace(/\uFFFD+$/, '');
}

function utf8SequenceLength(byte: number): number {
  if (byte < 0x80) return 1;
  if ((byte & 0b1110_0000) === 0b1100_0000) return 2;
  if ((byte & 0b1111_0000) === 0b1110_0000) return 3;
  return 4;
}

function wholeCharacterLength(bytes: Uint8Array): number {
  const CONTINUATION_LIMIT = 3;
  for (let back = 0; back <= CONTINUATION_LIMIT && back < bytes.length; back += 1) {
    const index = bytes.length - 1 - back;
    const byte = bytes[index] ?? 0;
    if ((byte & 0b1100_0000) === 0b1000_0000) continue;
    const needed = index + utf8SequenceLength(byte);
    return needed <= bytes.length ? bytes.length : index;
  }
  return bytes.length;
}

export async function readAttachment(
  principal: Principal,
  attachmentId: string,
  maxBytes: number,
  driver?: StorageDriver,
): Promise<AttachmentContent> {
  const record = await findAttachmentForOrganization(principal, attachmentId);
  await assertAttachmentReadable(principal, record);

  const store = driver ?? storageDriver();
  const bytes = await store.get(record.storageKey);
  if (bytes === null) throw notFound('That file is no longer in storage.');

  const truncated = bytes.byteLength > maxBytes;
  const slice = truncated ? bytes.slice(0, maxBytes) : bytes;
  const textual = isTextualContentType(record.contentType);
  return {
    attachment: toIssueAttachment(record),
    encoding: textual ? 'utf8' : 'base64',
    content: textual ? decodeWholeCharacters(slice) : Buffer.from(slice).toString('base64'),
    truncated,
  };
}

async function commentIssueId(principal: Principal, commentId: string): Promise<string | null> {
  const [comment] = await db
    .select({ issueId: schema.comment.issueId })
    .from(schema.comment)
    .where(
      and(
        eq(schema.comment.id, commentId),
        eq(schema.comment.organizationId, principal.organizationId),
        isNull(schema.comment.deletedAt),
      ),
    )
    .limit(1);
  return comment?.issueId ?? null;
}

export async function listAttachmentsFor(
  principal: Principal,
  parentType: 'issue' | 'comment' | 'doc' | 'project',
  parentId: string,
): Promise<IssueAttachment[]> {
  await assertAttachmentReadable(principal, {
    parentType,
    parentId,
    uploadedById: principal.userId,
  } as AttachmentRecord);
  const rows = await db
    .select()
    .from(schema.attachment)
    .where(
      and(
        eq(schema.attachment.organizationId, principal.organizationId),
        eq(schema.attachment.status, 'ready'),
        eq(schema.attachment.parentType, parentType),
        eq(schema.attachment.parentId, parentId),
      ),
    )
    .orderBy(asc(schema.attachment.createdAt));
  return rows.map(toIssueAttachment);
}
