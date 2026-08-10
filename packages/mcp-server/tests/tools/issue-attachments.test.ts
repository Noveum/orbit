import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { StorageDriver, StoredObject } from '@orbit/services/storage';

const storageModule = await import('@orbit/services/storage');

const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

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
    objects.set(key, { bytes: body, contentType });
    return Promise.resolve();
  },
  get: (key: string) => Promise.resolve(objects.get(key)?.bytes ?? null),
  getUrl: () => Promise.reject(new Error('unused')),
  delete: (key: string) => {
    objects.delete(key);
    return Promise.resolve();
  },
  stat: (key: string): Promise<StoredObject | null> => {
    const stored = objects.get(key);
    return Promise.resolve(
      stored === undefined
        ? null
        : {
            key,
            size: stored.bytes.byteLength,
            contentType: stored.contentType,
            updatedAt: new Date(),
          },
    );
  },
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

const REPORT = '# Weekly report\n\nRevenue is up.\n';

let workspace: TestWorkspace;
let admin: TestClient;
let issueId: string;
let issueIdentifier: string;
let commentId: string;
let issueAttachmentId: string;
let commentAttachmentId: string;
let binaryAttachmentId: string;

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));

  const created = await admin.result('create_issue', {
    team: workspace.teamKey,
    title: 'Ship the weekly report',
  });
  const issue = created['issue'] as { id: string; identifier: string };
  issueId = issue.id;
  issueIdentifier = issue.identifier;

  const commented = await admin.result('add_comment', {
    issue: issueIdentifier,
    body: 'Numbers attached.',
  });
  commentId = (commented['comment'] as { id: string }).id;

  const onIssue = await admin.result('attach_file', {
    parentType: 'issue',
    parentId: issueId,
    fileName: 'report.md',
    contentType: 'text/markdown',
    content: Buffer.from(REPORT, 'utf8').toString('base64'),
  });
  issueAttachmentId = (onIssue['attachment'] as { id: string }).id;

  const onComment = await admin.result('attach_file', {
    parentType: 'comment',
    parentId: commentId,
    fileName: 'numbers.csv',
    contentType: 'text/csv',
    content: Buffer.from('a,b\n1,2\n', 'utf8').toString('base64'),
  });
  commentAttachmentId = (onComment['attachment'] as { id: string }).id;

  const binary = await admin.result('attach_file', {
    parentType: 'issue',
    parentId: issueId,
    fileName: 'chart.png',
    contentType: 'image/png',
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
  });
  binaryAttachmentId = (binary['attachment'] as { id: string }).id;
});

describe('list_issue_attachments', () => {
  it('returns files attached to the issue and to its comments', async () => {
    const result = await admin.result('list_issue_attachments', { issue: issueIdentifier });
    const files = result['attachments'] as { fileName: string; attachedTo: string }[];

    expect(files.map((file) => file.fileName).sort()).toEqual([
      'chart.png',
      'numbers.csv',
      'report.md',
    ]);
    expect(files.find((file) => file.fileName === 'numbers.csv')?.attachedTo).toBe('comment');
    expect(files.find((file) => file.fileName === 'report.md')?.attachedTo).toBe('issue');
  });

  it('is empty for an issue with nothing attached', async () => {
    const other = await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Nothing attached here',
    });
    const result = await admin.result('list_issue_attachments', {
      issue: (other['issue'] as { identifier: string }).identifier,
    });
    expect(result['attachments']).toEqual([]);
  });
});

describe('get_issue', () => {
  it('reports what is attached, so an agent knows a file exists', async () => {
    const result = await admin.result('get_issue', { issue: issueIdentifier });
    const issue = result['issue'] as { attachments: { fileName: string }[] };
    expect(issue.attachments.map((file) => file.fileName).sort()).toEqual([
      'chart.png',
      'numbers.csv',
      'report.md',
    ]);
  });
});

describe('read_attachment', () => {
  it('returns a text file as text', async () => {
    const result = await admin.result('read_attachment', { attachment: issueAttachmentId });
    expect(result['encoding']).toBe('utf8');
    expect(result['content']).toBe(REPORT);
    expect(result['truncated']).toBe(false);
  });

  it('reads a file attached to a comment', async () => {
    const result = await admin.result('read_attachment', { attachment: commentAttachmentId });
    expect(result['content']).toBe('a,b\n1,2\n');
  });

  it('returns a binary file base64 encoded', async () => {
    const result = await admin.result('read_attachment', { attachment: binaryAttachmentId });
    expect(result['encoding']).toBe('base64');
    expect(
      Buffer.from(result['content'] as string, 'base64')
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
  });

  it('truncates and says so', async () => {
    const result = await admin.result('read_attachment', {
      attachment: issueAttachmentId,
      maxBytes: 5,
    });
    expect(result['truncated']).toBe(true);
    expect(result['content']).toBe(REPORT.slice(0, 5));
  });

  it('refuses an attachment from another workspace', async () => {
    const other = await createWorkspace('Rival');
    const outsider = await connect(await mintToken(other.organizationId, other.adminUser.id));
    const result = await outsider.call('read_attachment', { attachment: issueAttachmentId });
    expect(result.isError).toBe(true);
    expect(errorPayload(result).code).toBe('not_found');
    await outsider.close();
  });

  it('refuses a member who is not on the issue team', async () => {
    const created = await admin.result('create_team', { name: 'Secrets', key: 'SEC' });
    const team = created['team'] as { key: string };
    const secret = await admin.result('create_issue', {
      team: team.key,
      title: 'Board pack',
    });
    const secretIssue = secret['issue'] as { id: string; identifier: string };
    const stored = await admin.result('attach_file', {
      parentType: 'issue',
      parentId: secretIssue.id,
      fileName: 'board-pack.md',
      contentType: 'text/markdown',
      content: Buffer.from('confidential', 'utf8').toString('base64'),
    });
    const secretAttachmentId = (stored['attachment'] as { id: string }).id;

    const outsider = await addMember(workspace, 'contributor', 'Otto Outsider');
    const client = await connect(await mintToken(workspace.organizationId, outsider.user.id));

    const listed = await client.call('list_issue_attachments', { issue: secretIssue.identifier });
    expect(listed.isError).toBe(true);
    const read = await client.call('read_attachment', { attachment: secretAttachmentId });
    expect(read.isError).toBe(true);

    await client.close();
  });
});

describe('files on docs and projects', () => {
  it('lists and reads a file attached to a doc', async () => {
    const doc = await admin.result('create_doc', { title: 'Spec', content: 'body' });
    const docId = (doc['doc'] as { id: string }).id;
    const stored = await admin.result('attach_file', {
      parentType: 'doc',
      parentId: docId,
      fileName: 'spec.md',
      contentType: 'text/markdown',
      content: Buffer.from('the spec', 'utf8').toString('base64'),
    });
    const attachmentId = (stored['attachment'] as { id: string }).id;

    const listed = await admin.result('list_attachments', {
      parentType: 'doc',
      parentId: docId,
    });
    expect((listed['attachments'] as { fileName: string }[])[0]?.fileName).toBe('spec.md');

    const read = await admin.result('read_attachment', { attachment: attachmentId });
    expect(read['content']).toBe('the spec');
  });

  it('lists and reads a file attached to a project', async () => {
    const project = await admin.result('create_project', { name: 'Launch' });
    const projectId = (project['project'] as { id: string }).id;
    const stored = await admin.result('attach_file', {
      parentType: 'project',
      parentId: projectId,
      fileName: 'plan.csv',
      contentType: 'text/csv',
      content: Buffer.from('phase,week\n1,3\n', 'utf8').toString('base64'),
    });
    const attachmentId = (stored['attachment'] as { id: string }).id;

    const listed = await admin.result('list_attachments', {
      parentType: 'project',
      parentId: projectId,
    });
    expect((listed['attachments'] as { fileName: string }[])[0]?.fileName).toBe('plan.csv');

    const read = await admin.result('read_attachment', { attachment: attachmentId });
    expect(read['content']).toBe('phase,week\n1,3\n');
  });
});

describe('greptile findings', () => {
  it('never splits a multi-byte character when truncating', async () => {
    const emoji = 'héllo wörld 🌍 done';
    const stored = await admin.result('attach_file', {
      parentType: 'issue',
      parentId: issueId,
      fileName: 'utf8.md',
      contentType: 'text/markdown',
      content: Buffer.from(emoji, 'utf8').toString('base64'),
    });
    const id = (stored['attachment'] as { id: string }).id;

    const full = Buffer.from(emoji, 'utf8');
    for (let cut = 1; cut < full.byteLength; cut += 1) {
      const result = await admin.result('read_attachment', { attachment: id, maxBytes: cut });
      const text = result['content'] as string;
      expect(text).not.toContain('�');
      expect(emoji.startsWith(text)).toBe(true);
    }
  });

  it('stops reading a file whose comment was deleted', async () => {
    const commented = await admin.result('add_comment', {
      issue: issueIdentifier,
      body: 'Temporary, with a file.',
    });
    const doomedCommentId = (commented['comment'] as { id: string }).id;
    const stored = await admin.result('attach_file', {
      parentType: 'comment',
      parentId: doomedCommentId,
      fileName: 'secret.md',
      contentType: 'text/markdown',
      content: Buffer.from('should not survive', 'utf8').toString('base64'),
    });
    const id = (stored['attachment'] as { id: string }).id;

    expect((await admin.result('read_attachment', { attachment: id }))['content']).toBe(
      'should not survive',
    );

    await admin.result('delete_comment', { commentId: doomedCommentId });

    const afterList = await admin.result('list_issue_attachments', { issue: issueIdentifier });
    const names = (afterList['attachments'] as { fileName: string }[]).map((f) => f.fileName);
    expect(names).not.toContain('secret.md');

    const afterRead = await admin.call('read_attachment', { attachment: id });
    expect(afterRead.isError).toBe(true);
  });
});
