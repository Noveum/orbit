import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { createComment, createIssue, createTeam } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import type { StorageDriver, StoredObject } from '@orbit/services/storage';

const storageModule = await import('@orbit/services/storage');

const puts: { key: string; bytes: number; contentType: string }[] = [];
const objects = new Map<string, StoredObject>();

const fakeDriver = {
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
  delete: () => Promise.resolve(),
  stat: (key: string) => Promise.resolve(objects.get(key) ?? null),
} as unknown as StorageDriver;

mock.module('@orbit/services/storage', () => ({
  ...storageModule,
  storageDriver: () => fakeDriver,
}));

const {
  addMember,
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
}: typeof import('../../src/test-helpers.ts') = await import('../../src/test-helpers.ts');

type TestClient = Awaited<ReturnType<typeof connect>>;
type TestWorkspace = Awaited<ReturnType<typeof createWorkspace>>;

let workspace: TestWorkspace;
let admin: TestClient;
let guest: TestClient;
let issueId: string;
let issueIdentifier: string;
let commentId: string;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(await mintToken(workspace.organizationId, guestMember.user.id));

  const created = await admin.result('create_issue', {
    team: workspace.teamKey,
    title: 'Needs a screenshot',
  });
  const issue = created['issue'] as { id: string; identifier: string };
  issueId = issue.id;
  issueIdentifier = issue.identifier;
  const commented = await admin.result('add_comment', {
    issue: issueIdentifier,
    body: 'Here is what I saw.',
  });
  commentId = (commented['comment'] as { id: string }).id;
});

afterAll(async () => {
  await admin.close();
  await guest.close();
  mock.module('@orbit/services/storage', () => storageModule);
});

describe('attach_file', () => {
  it('hangs a file off a comment and hands back markdown that points at it', async () => {
    const before = puts.length;

    const payload = await admin.result('attach_file', {
      parentType: 'comment',
      parentId: commentId,
      fileName: 'console.log',
      contentType: 'text/plain',
      content: Buffer.from('boom at line 12').toString('base64'),
    });

    const attachment = payload['attachment'] as { id: string; size: number };
    expect(attachment.size).toBe(15);
    expect(puts.length).toBe(before + 1);
    expect(payload['markdown']).toBe(`[console.log](${String(payload['url'])})`);

    const [row] = await db
      .select({
        parentType: schema.attachment.parentType,
        parentId: schema.attachment.parentId,
        status: schema.attachment.status,
        organizationId: schema.attachment.organizationId,
      })
      .from(schema.attachment)
      .where(eq(schema.attachment.id, attachment.id))
      .limit(1);
    expect(row).toEqual({
      parentType: 'comment',
      parentId: commentId,
      status: 'ready',
      organizationId: workspace.organizationId,
    });
  });

  it('hangs a file off an issue too', async () => {
    const payload = await admin.result('attach_file', {
      parentType: 'issue',
      parentId: issueId,
      fileName: 'shot.png',
      contentType: 'image/png',
      content: Buffer.from('not really a png').toString('base64'),
    });

    const deltas = payload['deltas'] as { model: string; action: string; id: string }[];
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.model).toBe('attachment');
    expect(deltas[0]?.action).toBe('insert');
    expect(deltas[0]?.id).toBe(String((payload['attachment'] as { id: string }).id));
  });

  it('refuses a guest, whose role cannot upload at all', async () => {
    const before = puts.length;

    const refused = await guest.call('attach_file', {
      parentType: 'comment',
      parentId: commentId,
      fileName: 'console.log',
      contentType: 'text/plain',
      content: Buffer.from('sneaky').toString('base64'),
    });

    expect(refused.isError).toBe(true);
    expect(errorPayload(refused).code).toBe('forbidden');
    expect(puts.length).toBe(before);
  });

  it('refuses a parent that does not exist', async () => {
    const refused = await admin.call('attach_file', {
      parentType: 'comment',
      parentId: 'comment_that_never_was',
      fileName: 'console.log',
      contentType: 'text/plain',
      content: Buffer.from('nothing').toString('base64'),
    });

    expect(refused.isError).toBe(true);
    expect(errorPayload(refused).code).toBe('not_found');
  });

  it('refuses a comment on an issue in a team the caller is not in', async () => {
    const before = puts.length;
    const walled = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const state = walled.states[0];
    if (state === undefined) throw new Error('missing state');
    const behind = await createIssue(workspace.admin, {
      teamId: walled.team.id,
      title: 'Behind the wall',
      stateId: state.id,
    });
    const secret = await createComment(workspace.admin, behind.issue.id, { body: 'Private' });
    const insider = await addMember(workspace, 'member', 'Ida Insider');
    const outside = await connect(await mintToken(workspace.organizationId, insider.user.id));

    try {
      const refused = await outside.call('attach_file', {
        parentType: 'comment',
        parentId: secret.comment.id,
        fileName: 'console.log',
        contentType: 'text/plain',
        content: Buffer.from('let me in').toString('base64'),
      });

      expect(refused.isError).toBe(true);
      expect(errorPayload(refused).code).toBe('not_found');
      expect(puts.length).toBe(before);
    } finally {
      await outside.close();
    }
  });
});
