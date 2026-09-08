import { beforeEach, expect, it } from 'bun:test';
import { scopes } from '@orbit/shared/events';
import {
  createDoc,
  getDoc,
  getPublishedDoc,
  listDocAccess,
  listDocs,
  setDocAccess,
  shareDoc,
  updateDoc,
} from '../../src/content/doc-service.ts';
import { addMember, createWorkspace, resetDatabase } from '../../src/test-support.ts';

beforeEach(resetDatabase);

it('keeps a default document out of every other member and administrator session', async () => {
  const workspace = await createWorkspace('Example');
  const author = await addMember(workspace, 'member');
  const { doc } = await createDoc(author.principal, {
    title: 'Private notes',
    content: 'Synthetic notes',
  });
  expect(doc.visibility).toBe('private');
  expect(await listDocs(workspace.admin)).toHaveLength(0);
  await expect(getDoc(workspace.admin, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(updateDoc(workspace.admin, doc.id, { visibility: 'public' })).rejects.toMatchObject({
    code: 'not_found',
  });
});

it('revokes links and notifies previous readers without carrying private content', async () => {
  const workspace = await createWorkspace('Example');
  const reader = await addMember(workspace, 'member');
  const { doc } = await createDoc(workspace.admin, {
    title: 'Release notes',
    content: 'Synthetic release',
    visibility: 'link',
  });
  expect(await getPublishedDoc(doc.publishToken ?? '')).not.toBeNull();
  const closed = await shareDoc(workspace.admin, doc.id, { visibility: 'private' });
  expect(await getPublishedDoc(doc.publishToken ?? '')).toBeNull();
  const removal = closed.actions.find((action) => action.data['revoked'] === true);
  expect(removal?.scopes).toEqual([scopes.user(reader.user.id)]);
  expect(removal?.data).toEqual({ id: doc.id, accessChanged: true, revoked: true });
  expect(closed.actions[0]?.data['revoked']).toBe(false);
  await expect(getDoc(reader.principal, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  await setDocAccess(workspace.admin, doc.id, {
    grants: [{ subjectType: 'user', subjectId: reader.user.id, level: 'read' }],
  });
  expect((await getDoc(reader.principal, doc.id)).access).toBe('read');
  const revoked = await setDocAccess(workspace.admin, doc.id, { grants: [] });
  expect(revoked.actions.find((action) => action.data['revoked'] === true)?.scopes).toEqual([
    scopes.user(reader.user.id),
  ]);
  await expect(getDoc(reader.principal, doc.id)).rejects.toMatchObject({ code: 'not_found' });
});

it('does not let a published link confer editing or sharing authority', async () => {
  const workspace = await createWorkspace('Example');
  const reader = await addMember(workspace, 'member');
  for (const visibility of ['members', 'link', 'public']) {
    const { doc } = await createDoc(workspace.admin, { title: 'Shared page', visibility });
    expect((await getDoc(reader.principal, doc.id)).access).toBe('read');
    await expect(updateDoc(reader.principal, doc.id, { content: 'Changed' })).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: reader.user.id, level: 'write' }],
    });
    await expect(
      shareDoc(reader.principal, doc.id, { visibility, rotateToken: true }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      updateDoc(reader.principal, doc.id, { visibility: 'workspace' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  }
});

it('keeps the access list private to the author', async () => {
  const workspace = await createWorkspace('Example');
  const reader = await addMember(workspace, 'member');
  const { doc } = await createDoc(workspace.admin, {
    title: 'Shared page',
    visibility: 'workspace',
  });
  await expect(listDocAccess(reader.principal, doc.id)).rejects.toMatchObject({
    code: 'forbidden',
  });
  expect(await listDocAccess(workspace.admin, doc.id)).toEqual([]);
});

it('uses direct membership rather than a stale or admin-expanded team list', async () => {
  const workspace = await createWorkspace('Example');
  const author = await addMember(workspace, 'member');
  const outsider = await addMember(workspace, 'admin', { teamIds: [] });
  const { doc } = await createDoc(author.principal, { title: 'Team notes' });
  await setDocAccess(author.principal, doc.id, {
    grants: [{ subjectType: 'team', subjectId: workspace.teamId, level: 'write' }],
  });
  const expanded = { ...outsider.principal, teamIds: [workspace.teamId] };
  expect(await listDocs(expanded)).toEqual([]);
  await expect(getDoc(expanded, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(updateDoc(expanded, doc.id, { title: 'Changed' })).rejects.toMatchObject({
    code: 'not_found',
  });
});
