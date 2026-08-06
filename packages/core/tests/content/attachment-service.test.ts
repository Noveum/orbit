import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import {
  type AttachmentRecord,
  attachmentScopes,
  findAttachmentForOrganization,
  markAttachmentReady,
} from '../../src/content/attachment-service.ts';
import { createDoc } from '../../src/content/doc-service.ts';
import { newId } from '../../src/internal.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

let nova: Workspace;
let orion: Workspace;
let issueId: string;
let docId: string;

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');
  const { issue } = await createIssue(nova.admin, { teamId: nova.teamId, title: 'With a file' });
  issueId = issue.id;
  const created = await createDoc(nova.admin, { title: 'With a file', content: '' });
  docId = created.doc.id;
});

async function register(
  principal: Principal,
  parentType: 'issue' | 'doc' | 'user',
  parentId: string,
): Promise<AttachmentRecord> {
  const [row] = await db
    .insert(schema.attachment)
    .values({
      id: newId(),
      organizationId: principal.organizationId,
      parentType,
      parentId,
      fileName: 'shot.png',
      contentType: 'image/png',
      size: 0,
      storageKey: `uploads/${newId()}.png`,
      status: 'pending',
      uploadedById: principal.userId,
    })
    .returning();
  if (row === undefined) throw new Error('the attachment row was not written');
  return row;
}

async function errorOf(run: () => Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await run();
  } catch (error: unknown) {
    const thrown = error as { code?: unknown; status?: unknown };
    return {
      code: typeof thrown.code === 'string' ? thrown.code : 'not-a-domain-error',
      status: typeof thrown.status === 'number' ? thrown.status : 0,
    };
  }
  throw new Error('the call was expected to throw and did not');
}

describe('attachmentScopes', () => {
  it('publishes a doc upload on the doc, never on the uploader', () => {
    expect(
      attachmentScopes({ parentType: 'doc', parentId: 'doc_1', uploadedById: 'user_1' }),
    ).toEqual(['doc:doc_1']);
  });

  it('publishes an issue upload on the issue', () => {
    expect(
      attachmentScopes({ parentType: 'issue', parentId: 'issue_1', uploadedById: 'user_1' }),
    ).toEqual(['issue:issue_1']);
  });

  it('falls back to the uploader for anything with no shared parent', () => {
    expect(
      attachmentScopes({ parentType: 'user', parentId: 'user_2', uploadedById: 'user_1' }),
    ).toEqual(['user:user_1']);
  });
});

describe('findAttachmentForOrganization', () => {
  it('returns an upload registered in the caller workspace', async () => {
    const record = await register(nova.admin, 'issue', issueId);

    const found = await findAttachmentForOrganization(nova.admin, record.id);

    expect(found.id).toBe(record.id);
    expect(found.status).toBe('pending');
  });

  it('refuses to hand an upload to a member of another workspace', async () => {
    const record = await register(nova.admin, 'issue', issueId);

    expect(await errorOf(() => findAttachmentForOrganization(orion.admin, record.id))).toEqual({
      code: 'not_found',
      status: 404,
    });
  });

  it('refuses an id that was never registered', async () => {
    expect(
      await errorOf(() => findAttachmentForOrganization(nova.admin, 'att_does_not_exist')),
    ).toEqual({ code: 'not_found', status: 404 });
  });
});

describe('markAttachmentReady', () => {
  it('stores the size the object store reported and flips the row to ready', async () => {
    const record = await register(nova.admin, 'issue', issueId);

    const completed = await markAttachmentReady(nova.admin, record, 4_096);

    expect(completed.attachment.status).toBe('ready');
    expect(completed.attachment.size).toBe(4_096);
    const [row] = await db
      .select({ status: schema.attachment.status, size: schema.attachment.size })
      .from(schema.attachment)
      .where(eq(schema.attachment.id, record.id))
      .limit(1);
    expect(row).toEqual({ status: 'ready', size: 4_096 });
  });

  it('publishes an issue upload on the issue scope only', async () => {
    const record = await register(nova.admin, 'issue', issueId);

    const completed = await markAttachmentReady(nova.admin, record, 10);

    const action = completed.actions[0];
    expect(action?.model).toBe('attachment');
    expect(action?.action).toBe('update');
    expect(action?.organizationId).toBe(nova.organizationId);
    expect(action?.scopes).toEqual([`issue:${issueId}`]);
  });

  it('publishes a doc upload on the doc scope, so a reader without the doc never sees it', async () => {
    const record = await register(nova.admin, 'doc', docId);

    const completed = await markAttachmentReady(nova.admin, record, 10);

    expect(completed.actions[0]?.scopes).toEqual([`doc:${docId}`]);
  });

  it('publishes an upload with no shared parent to its uploader alone', async () => {
    const record = await register(nova.admin, 'user', nova.adminUser.id);

    const completed = await markAttachmentReady(nova.admin, record, 10);

    expect(completed.actions[0]?.scopes).toEqual([`user:${nova.adminUser.id}`]);
  });

  it('bumps the sync id so a catch up replays the completion', async () => {
    const record = await register(nova.admin, 'issue', issueId);

    const completed = await markAttachmentReady(nova.admin, record, 10);

    expect(completed.attachment.syncId).toBeGreaterThan(record.syncId);
    expect(completed.actions[0]?.syncId).toBe(completed.attachment.syncId);
  });
});
