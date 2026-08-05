import { beforeEach, describe, expect, it } from 'bun:test';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  createDoc,
  getPublishedDoc,
  listPublicDocs,
  setDocAccess,
  shareDoc,
} from './doc-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

describe('write grantee publishing', () => {
  it('checks whether bob can publish alice private doc', async () => {
    const alice = await addMember(workspace, 'member', { name: 'Alice' });
    const bob = await addMember(workspace, 'member', { name: 'Bob' });

    const { doc } = await createDoc(alice.principal, {
      title: 'Compensation review',
      content: 'Compensation numbers',
      visibility: 'private',
    });
    expect(doc.visibility).toBe('private');

    await setDocAccess(alice.principal, doc.id, {
      grants: [{ subjectType: 'user', subjectId: bob.user.id, level: 'write' }],
    });

    const shared = await shareDoc(bob.principal, doc.id, { visibility: 'public' });
    console.log('SHARE RESULT', shared.doc.visibility, shared.publishToken, shared.doc.slug);

    const token = shared.publishToken;
    if (token === null) throw new Error('no token');
    const anon = await getPublishedDoc(`${shared.doc.slug}-${token}`);
    console.log('ANON READ', anon === null ? null : anon.doc.content);

    const listed = await listPublicDocs();
    console.log(
      'SITEMAP CONTAINS',
      listed.some((row) => row.id === doc.id),
    );

    await expect(
      setDocAccess(bob.principal, doc.id, {
        grants: [{ subjectType: 'user', subjectId: bob.user.id, level: 'write' }],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('checks whether a read grantee is stopped', async () => {
    const alice = await addMember(workspace, 'member', { name: 'Alice' });
    const carol = await addMember(workspace, 'member', { name: 'Carol' });
    const { doc } = await createDoc(alice.principal, {
      title: 'Compensation review two',
      content: 'Compensation numbers',
      visibility: 'private',
    });
    await setDocAccess(alice.principal, doc.id, {
      grants: [{ subjectType: 'user', subjectId: carol.user.id, level: 'read' }],
    });
    await expect(shareDoc(carol.principal, doc.id, { visibility: 'public' })).rejects.toMatchObject(
      { code: 'forbidden' },
    );
  });
});
