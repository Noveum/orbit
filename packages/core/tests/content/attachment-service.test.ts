import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { StorageDriver, StoredObject } from '@orbit/services/storage';
import type { Principal } from '@orbit/shared/policy';
import {
  type AttachmentRecord,
  attachFile,
  attachmentScopes,
  findAttachmentForOrganization,
  finishUpload,
  markAttachmentReady,
  registerUpload,
} from '../../src/content/attachment-service.ts';
import { createComment } from '../../src/content/comment-service.ts';
import { createDoc } from '../../src/content/doc-service.ts';
import { newId } from '../../src/internal.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { createIssue } from '../../src/work/issue-service.ts';

let nova: Workspace;
let orion: Workspace;
let issueId: string;
let commentId: string;
let docId: string;

interface FakeStorage {
  readonly driver: StorageDriver;
  readonly puts: { key: string; bytes: number; contentType: string }[];
  readonly deletes: string[];
}

function fakeStorage(): FakeStorage {
  const puts: { key: string; bytes: number; contentType: string }[] = [];
  const deletes: string[] = [];
  const objects = new Map<string, StoredObject>();
  const driver = {
    name: 's3',
    createUploadTarget: (key: string, contentType: string, contentLength: number) =>
      Promise.resolve({
        key,
        url: `https://storage.test/${key}`,
        method: 'PUT',
        headers: { 'content-type': contentType },
        maxBytes: contentLength,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    put: (key: string, body: Uint8Array, contentType: string) => {
      puts.push({ key, bytes: body.byteLength, contentType });
      objects.set(key, { key, size: body.byteLength, contentType, updatedAt: new Date() });
      return Promise.resolve();
    },
    getUrl: () => Promise.reject(new Error('unused')),
    delete: (key: string) => {
      deletes.push(key);
      objects.delete(key);
      return Promise.resolve();
    },
    stat: (key: string) => Promise.resolve(objects.get(key) ?? null),
  } as unknown as StorageDriver;
  return { driver, puts, deletes };
}

beforeEach(async () => {
  await resetDatabase();
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');
  const { issue } = await createIssue(nova.admin, { teamId: nova.teamId, title: 'With a file' });
  issueId = issue.id;
  const comment = await createComment(nova.admin, issue.id, { body: 'Look at this' });
  commentId = comment.comment.id;
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

describe('registerUpload', () => {
  it('registers a comment upload and publishes it on the issue of that comment', async () => {
    const storage = fakeStorage();

    const registered = await registerUpload(
      nova.admin,
      {
        fileName: 'trace.log',
        contentType: 'text/plain',
        size: 12,
        parentType: 'comment',
        parentId: commentId,
      },
      storage.driver,
    );

    expect(registered.attachment.parentType).toBe('comment');
    expect(registered.attachment.parentId).toBe(commentId);
    expect(registered.attachment.status).toBe('pending');
    expect(registered.upload.method).toBe('PUT');
    expect(registered.actions[0]?.scopes).toEqual([`issue:${issueId}`]);
  });

  it('refuses a comment on an issue in a team the caller cannot see', async () => {
    const { team, states } = await createTeam(nova.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(nova.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const secret = await createComment(nova.admin, hidden.id, { body: 'Private' });
    const { principal } = await addMember(nova, 'member');
    const storage = fakeStorage();

    expect(
      await errorOf(() =>
        registerUpload(
          principal,
          {
            fileName: 'trace.log',
            contentType: 'text/plain',
            size: 12,
            parentType: 'comment',
            parentId: secret.comment.id,
          },
          storage.driver,
        ),
      ),
    ).toEqual({ code: 'not_found', status: 404 });
  });
});

describe('finishUpload', () => {
  it('flips a finished upload to ready with the size storage reported', async () => {
    const storage = fakeStorage();
    const registered = await registerUpload(
      nova.admin,
      {
        fileName: 'trace.log',
        contentType: 'text/plain',
        size: 64,
        parentType: 'comment',
        parentId: commentId,
      },
      storage.driver,
    );
    await storage.driver.put(registered.attachment.storageKey, new Uint8Array(40), 'text/plain');

    const done = await finishUpload(nova.admin, registered.attachment.id, storage.driver);

    expect(done.attachment.status).toBe('ready');
    expect(done.attachment.size).toBe(40);
  });

  it('refuses to finish an upload someone else registered', async () => {
    const storage = fakeStorage();
    const registered = await registerUpload(
      nova.admin,
      {
        fileName: 'trace.log',
        contentType: 'text/plain',
        size: 64,
        parentType: 'comment',
        parentId: commentId,
      },
      storage.driver,
    );
    await storage.driver.put(registered.attachment.storageKey, new Uint8Array(40), 'text/plain');
    const { principal } = await addMember(nova, 'member');

    expect(
      await errorOf(() => finishUpload(principal, registered.attachment.id, storage.driver)),
    ).toEqual({ code: 'not_found', status: 404 });
  });
});

describe('attachFile', () => {
  it('stores the decoded bytes and returns a url that serves them back', async () => {
    const storage = fakeStorage();

    const stored = await attachFile(
      nova.admin,
      {
        parentType: 'comment',
        parentId: commentId,
        fileName: 'notes.txt',
        contentType: 'text/plain',
        content: Buffer.from('hello orbit').toString('base64'),
      },
      storage.driver,
    );

    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]?.bytes).toBe(11);
    expect(stored.attachment.size).toBe(11);
    expect(stored.attachment.status).toBe('ready');
    expect(stored.url).toBe(`/api/files/${stored.attachment.storageKey}`);
    expect(stored.actions[0]?.scopes).toEqual([`issue:${issueId}`]);
  });

  it('refuses a workspace the caller does not belong to', async () => {
    const storage = fakeStorage();

    expect(
      await errorOf(() =>
        attachFile(
          orion.admin,
          {
            parentType: 'comment',
            parentId: commentId,
            fileName: 'notes.txt',
            contentType: 'text/plain',
            content: Buffer.from('hello orbit').toString('base64'),
          },
          storage.driver,
        ),
      ),
    ).toEqual({ code: 'not_found', status: 404 });
    expect(storage.puts).toHaveLength(0);
  });

  it('refuses a file type the workspace does not allow', async () => {
    const storage = fakeStorage();

    await expect(
      attachFile(
        nova.admin,
        {
          parentType: 'comment',
          parentId: commentId,
          fileName: 'payload.exe',
          contentType: 'application/x-msdownload',
          content: Buffer.from('MZ').toString('base64'),
        },
        storage.driver,
      ),
    ).rejects.toThrow();
    expect(storage.puts).toHaveLength(0);
  });

  it('refuses a comment on an issue in a team the caller cannot see', async () => {
    const { team, states } = await createTeam(nova.admin, { name: 'Design', key: 'DSGN' });
    const firstState = states[0];
    if (firstState === undefined) throw new Error('missing state');
    const { issue: hidden } = await createIssue(nova.admin, {
      teamId: team.id,
      title: 'Behind the wall',
      stateId: firstState.id,
    });
    const secret = await createComment(nova.admin, hidden.id, { body: 'Private' });
    const { principal } = await addMember(nova, 'member');
    const storage = fakeStorage();

    expect(
      await errorOf(() =>
        attachFile(
          principal,
          {
            parentType: 'comment',
            parentId: secret.comment.id,
            fileName: 'notes.txt',
            contentType: 'text/plain',
            content: Buffer.from('let me in').toString('base64'),
          },
          storage.driver,
        ),
      ),
    ).toEqual({ code: 'not_found', status: 404 });
    expect(storage.puts).toHaveLength(0);
  });

  it('takes the stored bytes back out when the row cannot be written', async () => {
    const storage = fakeStorage();
    const ghost: Principal = { ...nova.admin, userId: newId() };

    await expect(
      attachFile(
        ghost,
        {
          parentType: 'issue',
          parentId: issueId,
          fileName: 'notes.txt',
          contentType: 'text/plain',
          content: Buffer.from('hello orbit').toString('base64'),
        },
        storage.driver,
      ),
    ).rejects.toThrow();

    expect(storage.puts).toHaveLength(1);
    expect(storage.deletes).toEqual([storage.puts[0]?.key ?? 'no key was stored']);
  });
});
