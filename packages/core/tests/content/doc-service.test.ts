import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { DOC_CONTENT_LIMIT, DOC_TITLE_LIMIT } from '@orbit/shared/validators';
import {
  archiveDoc,
  createDoc,
  createDocCollection,
  deleteDoc,
  deleteDocCollection,
  docSlug,
  duplicateDoc,
  getDoc,
  getPublishedDoc,
  listDocCollections,
  listDocs,
  listDocVersions,
  listPublicDocs,
  publishedDocToken,
  resolvePublishedDoc,
  restoreDocVersion,
  setDocAccess,
  shareDoc,
  updateDoc,
  updateDocCollection,
} from '../../src/content/doc-service.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newDoc(title = 'Runbook', content = '# Runbook\n\nSteps.') {
  const { doc } = await createDoc(workspace.admin, { title, content });
  return doc;
}

describe('createDoc', () => {
  it('stores the doc, subscribes the author, and emits an insert scoped to the doc', async () => {
    const { doc, actions } = await createDoc(workspace.admin, {
      title: 'Realtime protocol',
      content: '# Realtime\n\nDeltas.',
    });

    expect(doc.title).toBe('Realtime protocol');
    expect(doc.visibility).toBe('workspace');
    expect(doc.publishToken).toBeNull();
    expect(actions).toHaveLength(1);
    expect(actions[0]?.model).toBe('doc');
    expect(actions[0]?.action).toBe('insert');
    expect(actions[0]?.scopes).toContain(scopes.doc(doc.id));
    expect(actions[0]?.scopes).toContain(scopes.organization(workspace.organizationId));
    expect(actions[0]?.syncId).toBeGreaterThan(0);
    expect(doc.kind).toBe('markdown');
  });

  it('stores a self-contained html page as its own kind', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Sync health',
      kind: 'html',
      content: '<!DOCTYPE html><html><body>ok</body></html>',
    });
    expect(doc.kind).toBe('html');
    expect(doc.content).toContain('<body>ok</body>');

    const copy = await duplicateDoc(workspace.admin, doc.id);
    expect(copy.doc.kind).toBe('html');
    expect(copy.doc.content).toBe(doc.content);
  });

  it('never leaks a publish token through the delta payload', async () => {
    const { actions } = await createDoc(workspace.admin, {
      title: 'Public brief',
      visibility: 'public',
    });
    expect(actions[0]?.data['publishToken']).toBe('redacted');
  });

  it('refuses a guest and refuses a contributor', async () => {
    const guest = await addMember(workspace, 'guest', { name: 'Gia Guest' });
    const contributor = await addMember(workspace, 'contributor', { name: 'Cody' });

    await expect(createDoc(guest.principal, { title: 'Nope' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(createDoc(contributor.principal, { title: 'Nope' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('rejects a collection from another workspace', async () => {
    const other = await createWorkspace('Other');
    const { collection } = await createDocCollection(other.admin, { name: 'Theirs' });

    await expect(
      createDoc(workspace.admin, { title: 'Cross tenant', collectionId: collection.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('listDocs', () => {
  it('lets a guest read but filters archived docs and matches title or body', async () => {
    const guest = await addMember(workspace, 'guest', { name: 'Gia Guest' });
    const keeper = await newDoc('Keyboard shortcuts', 'Press `C` to create.');
    const archived = await newDoc('Old notes', 'Nothing here.');
    await archiveDoc(workspace.admin, archived.id);

    const all = await listDocs(guest.principal);
    expect(all.map((row) => row.id)).toEqual([keeper.id]);

    const withArchived = await listDocs(guest.principal, { includeArchived: true });
    expect(withArchived).toHaveLength(2);

    expect(await listDocs(guest.principal, { query: 'keyboard' })).toHaveLength(1);
    expect(await listDocs(guest.principal, { query: 'Press `C`' })).toHaveLength(1);
    expect(await listDocs(guest.principal, { query: 'nothing at all' })).toHaveLength(0);
  });

  it('sends an excerpt instead of the whole body so a long list stays small', async () => {
    const body = 'A'.repeat(5000);
    await newDoc('Heavy doc', body);

    const [row] = await listDocs(workspace.admin);
    expect(row?.content).toBe('');
    expect(row?.excerpt.length).toBeLessThan(body.length);
    expect(row?.excerpt.startsWith('AAA')).toBe(true);
  });

  it('never returns docs from another workspace', async () => {
    await newDoc('Ours');
    const other = await createWorkspace('Other');
    await createDoc(other.admin, { title: 'Theirs' });

    const rows = await listDocs(workspace.admin);
    expect(rows.map((row) => row.title)).toEqual(['Ours']);
  });
});

describe('updateDoc', () => {
  it('patches only the given fields and emits an update', async () => {
    const doc = await newDoc();
    const { doc: saved, actions } = await updateDoc(workspace.admin, doc.id, {
      content: '# Runbook\n\nNew steps.',
    });

    expect(saved.title).toBe(doc.title);
    expect(saved.content).toBe('# Runbook\n\nNew steps.');
    expect(saved.syncId).toBeGreaterThan(doc.syncId);
    expect(actions[0]?.action).toBe('update');
  });

  it('refuses to edit an archived doc', async () => {
    const doc = await newDoc();
    await archiveDoc(workspace.admin, doc.id);
    await expect(updateDoc(workspace.admin, doc.id, { title: 'Nope' })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('refuses a guest', async () => {
    const doc = await newDoc();
    const guest = await addMember(workspace, 'guest', { name: 'Gia Guest' });
    await expect(updateDoc(guest.principal, doc.id, { title: 'Nope' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('mints and clears the publish token when the visibility changes', async () => {
    const doc = await newDoc();

    const opened = await updateDoc(workspace.admin, doc.id, { visibility: 'link' });
    const token = opened.doc.publishToken;
    expect(token).not.toBeNull();
    if (token === null) return;
    expect(await getPublishedDoc(token)).not.toBeNull();

    const kept = await updateDoc(workspace.admin, doc.id, { title: 'Still shared' });
    expect(kept.doc.publishToken).toBe(token);

    const closed = await updateDoc(workspace.admin, doc.id, { visibility: 'workspace' });
    expect(closed.doc.publishToken).toBeNull();
    expect(await getPublishedDoc(token)).toBeNull();
  });
});

describe('archiveDoc', () => {
  it('archives and restores, emitting the matching action', async () => {
    const doc = await newDoc();

    const archived = await archiveDoc(workspace.admin, doc.id);
    expect(archived.doc.archivedAt).not.toBeNull();
    expect(archived.actions[0]?.action).toBe('archive');

    const restored = await archiveDoc(workspace.admin, doc.id, false);
    expect(restored.doc.archivedAt).toBeNull();
    expect(restored.actions[0]?.action).toBe('update');
  });
});

describe('shareDoc', () => {
  it('mints a token on publish, keeps it stable, and revokes it back to workspace', async () => {
    const doc = await newDoc();
    expect(await getPublishedDoc('missing')).toBeNull();

    const published = await shareDoc(workspace.admin, doc.id, { visibility: 'public' });
    const token = published.publishToken;
    expect(token).not.toBeNull();
    if (token === null) return;
    expect(published.doc.visibility).toBe('public');

    const visitor = await getPublishedDoc(token);
    expect(visitor?.doc.id).toBe(doc.id);

    const again = await shareDoc(workspace.admin, doc.id, { visibility: 'link' });
    expect(again.publishToken).toBe(token);
    expect(await getPublishedDoc(token)).not.toBeNull();

    const revoked = await shareDoc(workspace.admin, doc.id, { visibility: 'workspace' });
    expect(revoked.publishToken).toBeNull();
    expect(await getPublishedDoc(token)).toBeNull();
  });

  it('hides an archived doc from its published url', async () => {
    const doc = await newDoc();
    const published = await shareDoc(workspace.admin, doc.id, { visibility: 'public' });
    const token = published.publishToken;
    if (token === null) throw new Error('expected a token');

    await archiveDoc(workspace.admin, doc.id);
    expect(await getPublishedDoc(token)).toBeNull();
  });

  it('refuses a contributor', async () => {
    const doc = await newDoc();
    const contributor = await addMember(workspace, 'contributor', { name: 'Cody' });
    await expect(
      shareDoc(contributor.principal, doc.id, { visibility: 'public' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('collections', () => {
  it('creates, renames, deletes, and orphans its docs on delete', async () => {
    const { collection } = await createDocCollection(workspace.admin, { name: 'Engineering' });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Protocol',
      collectionId: collection.id,
    });
    expect(doc.collectionId).toBe(collection.id);

    const renamed = await updateDocCollection(workspace.admin, collection.id, { name: 'Eng' });
    expect(renamed.collection.name).toBe('Eng');
    expect(renamed.actions[0]?.action).toBe('update');

    const actions = await deleteDocCollection(workspace.admin, collection.id);
    expect(actions[0]?.action).toBe('delete');
    expect(await listDocCollections(workspace.admin)).toHaveLength(0);

    const detail = await getDoc(workspace.admin, doc.id);
    expect(detail.doc.collectionId).toBeNull();
    expect(detail.attachments).toEqual([]);
  });

  it('refuses a guest', async () => {
    const guest = await addMember(workspace, 'guest', { name: 'Gia Guest' });
    await expect(createDocCollection(guest.principal, { name: 'Nope' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses deletion if the collection contains a document the deleter cannot write', async () => {
    const member1 = await addMember(workspace, 'member', { name: 'Member One' });
    const member2 = await addMember(workspace, 'member', { name: 'Member Two' });
    const { collection } = await createDocCollection(member1.principal, { name: 'Shared Folder' });
    const { doc } = await createDoc(member2.principal, {
      title: 'Secret Doc',
      collectionId: collection.id,
      visibility: 'private',
    });
    await expect(deleteDocCollection(member1.principal, collection.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const detail = await getDoc(workspace.admin, doc.id);
    expect(detail.doc.collectionId).toBe(collection.id);
  });

  it('refuses deletion if the collection contains a team document the deleter cannot write', async () => {
    const { team } = await createTeam(workspace.admin, { name: 'Design', key: 'DES' });
    const member1 = await addMember(workspace, 'member', { name: 'Member One' });
    const member2 = await addMember(workspace, 'member', {
      name: 'Member Two',
      teamIds: [team.id],
    });
    const { collection } = await createDocCollection(member1.principal, { name: 'Shared Folder' });
    const { doc } = await createDoc(member2.principal, {
      title: 'Design Specs',
      collectionId: collection.id,
      visibility: 'team',
    });
    await setDocAccess(member2.principal, doc.id, {
      grants: [
        { subjectType: 'team', subjectId: team.id, level: 'write' },
        { subjectType: 'user', subjectId: member1.principal.userId, level: 'read' },
      ],
    });
    await expect(deleteDocCollection(member1.principal, collection.id)).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringContaining('Design Specs'),
    });
    const detail = await getDoc(workspace.admin, doc.id);
    expect(detail.doc.collectionId).toBe(collection.id);
  });

  it("allows an admin to delete a collection containing another member's private document", async () => {
    const member = await addMember(workspace, 'member', { name: 'Member' });
    const { collection } = await createDocCollection(workspace.admin, { name: 'Shared Folder' });
    await createDoc(member.principal, {
      title: 'Secret Doc',
      collectionId: collection.id,
      visibility: 'private',
    });
    const actions = await deleteDocCollection(workspace.admin, collection.id);
    expect(actions[0]?.action).toBe('delete');
  });

  it("allows a member to delete a collection containing another member's published document", async () => {
    const member1 = await addMember(workspace, 'member', { name: 'Member One' });
    const member2 = await addMember(workspace, 'member', { name: 'Member Two' });
    const { collection } = await createDocCollection(member1.principal, { name: 'Shared Folder' });
    await createDoc(member2.principal, {
      title: 'Public Doc',
      collectionId: collection.id,
      visibility: 'public',
    });
    const actions = await deleteDocCollection(member1.principal, collection.id);
    expect(actions[0]?.action).toBe('delete');
  });
});

describe('published doc urls', () => {
  it('reads the token out of a slugged path and out of a bare token', () => {
    expect(publishedDocToken('delta-protocol-abc123')).toBe('abc123');
    expect(publishedDocToken('abc123')).toBe('abc123');
    expect(publishedDocToken('  ')).toBe('');
    expect(docSlug('Realtime delta protocol!')).toBe('realtime-delta-protocol');
    expect(docSlug('   ')).toBe('doc');
  });

  it('resolves the slugged url and keeps the old bare token url working', async () => {
    const doc = await newDoc('Realtime delta protocol');
    const published = await shareDoc(workspace.admin, doc.id, { visibility: 'public' });
    const token = published.publishToken;
    if (token === null) throw new Error('expected a token');

    expect(published.doc.slug).toBe('realtime-delta-protocol');
    expect(await getPublishedDoc(`realtime-delta-protocol-${token}`)).not.toBeNull();
    expect(await getPublishedDoc(token)).not.toBeNull();
    expect(await getPublishedDoc(`anything-${token}`)).not.toBeNull();
    expect(await getPublishedDoc(`realtime-delta-protocol-${token}x`)).toBeNull();
  });

  it('keeps the slug stable when the title is edited', async () => {
    const doc = await newDoc('Realtime delta protocol');
    await shareDoc(workspace.admin, doc.id, { visibility: 'public' });
    const renamed = await updateDoc(workspace.admin, doc.id, { title: 'Something else entirely' });
    expect(renamed.doc.slug).toBe('realtime-delta-protocol');
  });
});

describe('visibility modes', () => {
  it('hides public pages and sitemap entries while workspace deletion is pending', async () => {
    const open = await newDoc('Open notes');
    const published = await shareDoc(workspace.admin, open.id, { visibility: 'public' });
    const token = published.publishToken;
    if (token === null) throw new Error('expected a token');
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, workspace.organizationId));

    expect(await getPublishedDoc(token)).toBeNull();
    expect((await listPublicDocs()).some((row) => row.id === open.id)).toBe(false);
  });

  it('lists a public doc in the sitemap feed and never an unlisted one', async () => {
    const open = await newDoc('Open notes');
    const unlisted = await newDoc('Quiet notes');
    await shareDoc(workspace.admin, open.id, { visibility: 'public' });
    await shareDoc(workspace.admin, unlisted.id, { visibility: 'link' });

    const listed = (await listPublicDocs()).filter(
      (row) => row.organizationId === workspace.organizationId,
    );
    expect(listed.map((row) => row.id)).toEqual([open.id]);
  });

  it('revokes an unlisted link by rotating the token while the doc stays reachable', async () => {
    const doc = await newDoc();
    const shared = await shareDoc(workspace.admin, doc.id, { visibility: 'link' });
    const first = shared.publishToken;
    if (first === null) throw new Error('expected a token');
    expect(await getPublishedDoc(first)).not.toBeNull();

    const rotated = await shareDoc(workspace.admin, doc.id, {
      visibility: 'link',
      rotateToken: true,
    });
    const second = rotated.publishToken;
    if (second === null) throw new Error('expected a token');

    expect(second).not.toBe(first);
    expect(await getPublishedDoc(first)).toBeNull();
    expect(await getPublishedDoc(second)).not.toBeNull();
    expect(rotated.actions[0]?.action).toBe('update');
    expect(rotated.actions[0]?.data['publishToken']).toBe('redacted');
  });

  it('mints a members link that only a signed-in workspace member can open', async () => {
    const doc = await newDoc('Internal brief');
    const shared = await shareDoc(workspace.admin, doc.id, { visibility: 'members' });
    const token = shared.publishToken;
    if (token === null) throw new Error('expected a token');

    expect(shared.doc.visibility).toBe('members');
    expect(await getPublishedDoc(token)).toBeNull();
    expect(await resolvePublishedDoc(token, null)).toEqual({ status: 'sign-in' });

    const member = await addMember(workspace, 'guest', { name: 'Gia Guest' });
    const opened = await resolvePublishedDoc(token, member.user.id);
    expect(opened.status).toBe('ok');
    if (opened.status !== 'ok') return;
    expect(opened.detail.doc.id).toBe(doc.id);
    expect((await listDocs(member.principal)).some((row) => row.id === doc.id)).toBe(true);

    const other = await createWorkspace('Elsewhere');
    expect(await resolvePublishedDoc(token, other.adminUser.id)).toEqual({ status: 'missing' });
    expect((await listPublicDocs()).some((row) => row.id === doc.id)).toBe(false);
  });
});

describe('doc nesting', () => {
  it('nests a doc under a parent and refuses a cycle', async () => {
    const root = await newDoc('Root');
    const child = await updateDoc(workspace.admin, (await newDoc('Child')).id, {
      parentId: root.id,
    });
    expect(child.doc.parentId).toBe(root.id);

    await expect(
      updateDoc(workspace.admin, root.id, { parentId: child.doc.id }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(updateDoc(workspace.admin, root.id, { parentId: root.id })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('refuses a parent from another workspace', async () => {
    const other = await createWorkspace('Other');
    const { doc: theirs } = await createDoc(other.admin, { title: 'Theirs' });
    await expect(
      createDoc(workspace.admin, { title: 'Ours', parentId: theirs.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('doc versions', () => {
  it('snapshots on save and restores by writing a new version instead of mutating history', async () => {
    const doc = await newDoc('Runbook', 'v1');
    const second = await addMember(workspace, 'admin', { name: 'Second Author' });

    await updateDoc(second.principal, doc.id, { content: 'v2' });
    const history = await listDocVersions(workspace.admin, doc.id);
    expect(history.map((entry) => entry.content)).toEqual(['v2', 'v1']);

    const oldest = history.at(-1);
    if (oldest === undefined) throw new Error('expected a version');

    const restored = await restoreDocVersion(second.principal, doc.id, oldest.id);
    expect(restored.doc.content).toBe('v1');

    const after = await listDocVersions(workspace.admin, doc.id);
    expect(after).toHaveLength(3);
    expect(after[0]?.restoredFromId).toBe(oldest.id);
    expect(after.map((entry) => entry.content)).toEqual(['v1', 'v2', 'v1']);
    expect((await listDocVersions(workspace.admin, doc.id))[2]?.id).toBe(oldest.id);
  });

  it('coalesces a burst of autosaves from one author into one version', async () => {
    const doc = await newDoc('Runbook', 'v1');
    await updateDoc(workspace.admin, doc.id, { content: 'v2' });
    await updateDoc(workspace.admin, doc.id, { content: 'v3' });
    await updateDoc(workspace.admin, doc.id, { title: 'Runbook' });

    const history = await listDocVersions(workspace.admin, doc.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe('v3');
  });

  it('refuses to restore a version that belongs to another doc', async () => {
    const doc = await newDoc();
    const other = await newDoc('Other', 'body');
    const history = await listDocVersions(workspace.admin, other.id);
    const foreign = history[0];
    if (foreign === undefined) throw new Error('expected a version');

    await expect(restoreDocVersion(workspace.admin, doc.id, foreign.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('backlinks', () => {
  it('reports the docs that link here and ignores archived and foreign ones', async () => {
    const target = await newDoc('Target', 'body');
    const linking = await newDoc('Linking', `see [target](/docs/${target.id})`);
    const archived = await newDoc('Archived', `also [target](/docs/${target.id})`);
    await archiveDoc(workspace.admin, archived.id);
    await newDoc('Unrelated', 'nothing');

    const detail = await getDoc(workspace.admin, target.id);
    expect(detail.backlinks.map((entry) => entry.id)).toEqual([linking.id]);
    expect((await getDoc(workspace.admin, linking.id)).backlinks).toEqual([]);
  });
});

describe('doc access', () => {
  it('keeps a private doc away from everyone but its author', async () => {
    const { principal: other } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Compensation review',
      content: 'Numbers nobody else should read.',
      visibility: 'private',
    });

    await expect(getDoc(other, doc.id)).rejects.toMatchObject({ code: 'not_found' });
    const listed = await listDocs(other, {});
    expect(listed.some((row) => row.id === doc.id)).toBe(false);

    const asAuthor = await getDoc(workspace.admin, doc.id);
    expect(asAuthor.doc.id).toBe(doc.id);
  });

  it('shares a private doc with exactly the people it was shared with', async () => {
    const { principal: invited, user: invitedUser } = await addMember(workspace, 'member');
    const { principal: stranger } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Shared plan',
      content: 'For a named few.',
      visibility: 'private',
    });

    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: invitedUser.id, level: 'read' }],
    });

    expect((await getDoc(invited, doc.id)).doc.id).toBe(doc.id);
    expect((await listDocs(invited, {})).some((row) => row.id === doc.id)).toBe(true);
    await expect(getDoc(stranger, doc.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shares with a whole team when the grant names one', async () => {
    const team = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
    const { principal: designer } = await addMember(workspace, 'member', {
      teamIds: [team.team.id],
    });
    const { doc } = await createDoc(workspace.admin, {
      title: 'Design brief',
      content: 'For the design team.',
      visibility: 'private',
    });

    await expect(getDoc(designer, doc.id)).rejects.toMatchObject({ code: 'not_found' });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'team', subjectId: team.team.id, level: 'read' }],
    });
    expect((await getDoc(designer, doc.id)).doc.id).toBe(doc.id);
  });

  it('leaves workspace docs readable by everyone, as before', async () => {
    const { principal: guest } = await addMember(workspace, 'guest');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Handbook',
      content: 'Everybody reads this.',
      visibility: 'workspace',
    });
    expect((await getDoc(guest, doc.id)).doc.id).toBe(doc.id);
  });

  it('lets an admin reach a private doc they do not own', async () => {
    const { principal: author, user: authorUser } = await addMember(workspace, 'member');
    const { doc } = await createDoc(author, {
      title: 'Personal notes',
      content: 'Mine.',
      visibility: 'private',
    });
    expect(doc.authorId).toBe(authorUser.id);
    expect((await getDoc(workspace.admin, doc.id)).doc.id).toBe(doc.id);
  });
});

describe('a doc body never travels on the wire', () => {
  it('announces a change without the content', async () => {
    const secret = 'A body that should never appear in a delta payload.';
    const { actions } = await createDoc(workspace.admin, {
      title: 'Long doc',
      content: secret,
      visibility: 'workspace',
    });

    const payload = JSON.stringify(actions);
    expect(actions.length).toBeGreaterThan(0);
    expect(payload).not.toContain(secret);
    expect(payload).toContain('Long doc');
  });

  it('accepts a document far larger than the old hundred kilobyte cap', async () => {
    const long = 'x'.repeat(200_000);
    const { doc } = await createDoc(workspace.admin, {
      title: 'Very long',
      content: long,
      visibility: 'workspace',
    });
    const read = await getDoc(workspace.admin, doc.id);
    expect(read.doc.content.length).toBe(200_000);
  });

  it('refuses a document past the doc limit with an explanation', async () => {
    await expect(
      createDoc(workspace.admin, {
        title: 'Too long',
        content: 'x'.repeat(DOC_CONTENT_LIMIT + 1),
        visibility: 'workspace',
      }),
    ).rejects.toThrow();
  });
});

describe('a read grant does not become a write grant', () => {
  it('refuses an edit from somebody granted read only', async () => {
    const { principal: reader, user: readerUser } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Board pack',
      content: 'Read this, do not change it.',
      visibility: 'private',
    });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: readerUser.id, level: 'read' }],
    });

    expect((await getDoc(reader, doc.id)).doc.id).toBe(doc.id);
    await expect(updateDoc(reader, doc.id, { title: 'Hijacked' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(archiveDoc(reader, doc.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows an edit from somebody granted write', async () => {
    const { principal: editor, user: editorUser } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Shared draft',
      content: 'Edit away.',
      visibility: 'private',
    });
    await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: editorUser.id, level: 'write' }],
    });

    const saved = await updateDoc(editor, doc.id, { title: 'Edited' });
    expect(saved.doc.title).toBe('Edited');
  });

  it('leaves a workspace doc editable by anyone who may write docs', async () => {
    const { principal: member } = await addMember(workspace, 'member');
    const { doc } = await createDoc(workspace.admin, {
      title: 'Handbook',
      content: 'Everyone edits this.',
      visibility: 'workspace',
    });
    const saved = await updateDoc(member, doc.id, { title: 'Handbook v2' });
    expect(saved.doc.title).toBe('Handbook v2');
  });
});

describe('backlinks respect who may read the linking doc', () => {
  it('hides a private doc that links to one you can read', async () => {
    const { doc: target } = await createDoc(workspace.admin, {
      title: 'Deploy runbook',
      content: 'How we ship.',
      visibility: 'workspace',
    });
    await createDoc(workspace.admin, {
      title: 'Layoff plan',
      content: `See /docs/${target.id} before the announcement.`,
      visibility: 'private',
    });
    const { principal: member } = await addMember(workspace, 'member');

    const seen = await getDoc(member, target.id);
    expect(seen.backlinks.map((link) => link.title)).not.toContain('Layoff plan');

    const asAdmin = await getDoc(workspace.admin, target.id);
    expect(asAdmin.backlinks.map((link) => link.title)).toContain('Layoff plan');
  });

  it('still shows a workspace doc that links to it', async () => {
    const { doc: target } = await createDoc(workspace.admin, {
      title: 'Deploy runbook',
      content: 'How we ship.',
      visibility: 'workspace',
    });
    await createDoc(workspace.admin, {
      title: 'Onboarding',
      content: `Read /docs/${target.id} on day one.`,
      visibility: 'workspace',
    });
    const { principal: member } = await addMember(workspace, 'member');

    const seen = await getDoc(member, target.id);
    expect(seen.backlinks.map((link) => link.title)).toContain('Onboarding');
  });
});

describe('sharing a doc with named people', () => {
  it('grants read to a person and lets them open a doc they could not see before', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Board deck',
      content: 'Numbers.',
      visibility: 'private',
    });
    const { principal: outsider, user } = await addMember(workspace, 'member');
    await expect(getDoc(outsider, doc.id)).rejects.toMatchObject({ code: 'not_found' });

    const saved = await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: user.id, level: 'read' }],
    });
    expect(saved.grants).toHaveLength(1);
    expect((await getDoc(outsider, doc.id)).doc.id).toBe(doc.id);
  });

  it('reaches the person it was shared with over realtime, not just the workspace', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Board deck',
      content: 'Numbers.',
      visibility: 'private',
    });
    const { user } = await addMember(workspace, 'member');
    const saved = await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: user.id, level: 'read' }],
    });
    expect(saved.actions).toHaveLength(1);
    expect(saved.actions[0]?.scopes).toContain(scopes.user(user.id));
    expect(saved.actions[0]?.scopes).toContain(scopes.doc(doc.id));
  });

  it('refuses to share with somebody outside the workspace', async () => {
    const { doc } = await createDoc(workspace.admin, { title: 'Board deck', content: 'x' });
    const other = await createWorkspace('Vega');
    await expect(
      setDocAccess(workspace.admin, doc.id, {
        grants: [{ subjectType: 'user', subjectId: other.adminUser.id, level: 'read' }],
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('lets a read grant read but not write, and a write grant do both', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Runbook',
      content: 'Steps.',
      visibility: 'private',
    });
    const reader = await addMember(workspace, 'member');
    const writer = await addMember(workspace, 'member');
    await setDocAccess(workspace.admin, doc.id, {
      grants: [
        { subjectType: 'user', subjectId: reader.user.id, level: 'read' },
        { subjectType: 'user', subjectId: writer.user.id, level: 'write' },
      ],
    });

    await expect(
      updateDoc(reader.principal, doc.id, { content: 'Reader edit' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const edited = await updateDoc(writer.principal, doc.id, { content: 'Writer edit' });
    expect(edited.doc.content).toBe('Writer edit');
  });

  it('keeps one row per subject when the same person is named twice', async () => {
    const { doc } = await createDoc(workspace.admin, { title: 'Runbook', content: 'x' });
    const { user } = await addMember(workspace, 'member');
    const saved = await setDocAccess(workspace.admin, doc.id, {
      grants: [
        { subjectType: 'user', subjectId: user.id, level: 'read' },
        { subjectType: 'user', subjectId: user.id, level: 'write' },
      ],
    });
    expect(saved.grants).toHaveLength(1);
    expect(saved.grants[0]?.level).toBe('write');
  });

  it('stops somebody who is neither the author nor an admin from regranting it', async () => {
    const { doc } = await createDoc(workspace.admin, { title: 'Runbook', content: 'x' });
    const { principal: member, user } = await addMember(workspace, 'member');
    await expect(
      setDocAccess(member, doc.id, {
        grants: [{ subjectType: 'user', subjectId: user.id, level: 'write' }],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('who may widen the audience of a doc', () => {
  it('stops a write grantee publishing somebody else’s private doc to the web', async () => {
    const alice = await addMember(workspace, 'member', { name: 'Alice' });
    const bob = await addMember(workspace, 'member', { name: 'Bob' });

    const { doc } = await createDoc(alice.principal, {
      title: 'Compensation review',
      content: 'Numbers.',
      visibility: 'private',
    });
    await setDocAccess(alice.principal, doc.id, {
      grants: [{ subjectType: 'user', subjectId: bob.user.id, level: 'write' }],
    });

    await expect(shareDoc(bob.principal, doc.id, { visibility: 'public' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      updateDoc(bob.principal, doc.id, { visibility: 'workspace' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect((await listPublicDocs()).some((row) => row.id === doc.id)).toBe(false);
  });

  it('lets the author widen it, and lets a grantee still edit the body', async () => {
    const alice = await addMember(workspace, 'member', { name: 'Alice' });
    const bob = await addMember(workspace, 'member', { name: 'Bob' });
    const { doc } = await createDoc(alice.principal, {
      title: 'Runbook',
      content: 'Steps.',
      visibility: 'private',
    });
    await setDocAccess(alice.principal, doc.id, {
      grants: [{ subjectType: 'user', subjectId: bob.user.id, level: 'write' }],
    });

    const edited = await updateDoc(bob.principal, doc.id, { content: 'Bob edited.' });
    expect(edited.doc.content).toBe('Bob edited.');

    const widened = await updateDoc(alice.principal, doc.id, { visibility: 'workspace' });
    expect(widened.doc.visibility).toBe('workspace');
  });

  it('lets a write grantee narrow it back down, which takes nothing away from anyone', async () => {
    const alice = await addMember(workspace, 'member', { name: 'Alice' });
    const bob = await addMember(workspace, 'member', { name: 'Bob' });
    const { doc } = await createDoc(alice.principal, {
      title: 'Runbook',
      content: 'Steps.',
      visibility: 'workspace',
    });
    await setDocAccess(alice.principal, doc.id, {
      grants: [{ subjectType: 'user', subjectId: bob.user.id, level: 'write' }],
    });
    const narrowed = await updateDoc(bob.principal, doc.id, { visibility: 'private' });
    expect(narrowed.doc.visibility).toBe('private');
  });
});

describe('a restricted doc reaches the people it is shared with', () => {
  it('addresses the sharing change at the grantee, who subscribes to their own scope', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Board deck',
      content: 'Numbers.',
      visibility: 'private',
    });
    const { user } = await addMember(workspace, 'member');
    const saved = await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'user', subjectId: user.id, level: 'read' }],
    });

    const reach = saved.actions[0]?.scopes ?? [];
    expect(reach).toContain(scopes.user(user.id));
    expect(reach).toContain(scopes.doc(doc.id));
    expect(reach).not.toContain(scopes.organization(workspace.organizationId));
  });

  it('addresses a team grant at the team', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Board deck',
      content: 'Numbers.',
      visibility: 'team',
    });
    const saved = await setDocAccess(workspace.admin, doc.id, {
      grants: [{ subjectType: 'team', subjectId: workspace.teamId, level: 'read' }],
    });
    expect(saved.actions[0]?.scopes).toContain(scopes.team(workspace.teamId));
  });
});

describe('the access level a doc reports is the level the write path enforces', () => {
  async function attemptWrite(principal: Principal, docId: string): Promise<'write' | 'read'> {
    try {
      await updateDoc(principal, docId, { content: `Edited ${docId}.` });
      return 'write';
    } catch {
      return 'read';
    }
  }

  it('agrees with updateDoc for every reader of a restricted doc and an open one', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const reader = await addMember(workspace, 'member', { name: 'Rey Reader' });
    const writer = await addMember(workspace, 'member', { name: 'Wren Writer' });
    const guest = await addMember(workspace, 'guest', { name: 'Gia Guest' });

    const { doc: restricted } = await createDoc(author.principal, {
      title: 'Board deck',
      content: 'Numbers.',
      visibility: 'private',
    });
    await setDocAccess(author.principal, restricted.id, {
      grants: [
        { subjectType: 'user', subjectId: reader.user.id, level: 'read' },
        { subjectType: 'user', subjectId: writer.user.id, level: 'write' },
      ],
    });
    const { doc: open } = await createDoc(author.principal, {
      title: 'Handbook',
      content: 'Everybody reads this.',
      visibility: 'workspace',
    });

    const people = [
      { name: 'author', principal: author.principal },
      { name: 'reader', principal: reader.principal },
      { name: 'writer', principal: writer.principal },
      { name: 'guest', principal: guest.principal },
      { name: 'admin', principal: workspace.admin },
    ];

    const reported: string[] = [];
    for (const person of people) {
      for (const doc of [restricted, open]) {
        const detail = await getDoc(person.principal, doc.id).catch(() => null);
        if (detail === null) continue;
        const enforced = await attemptWrite(person.principal, doc.id);
        reported.push(`${person.name}/${doc.title}/${detail.access}`);
        expect(`${person.name}/${doc.title}/${detail.access}`).toBe(
          `${person.name}/${doc.title}/${enforced}`,
        );
      }
    }

    expect(reported).toEqual([
      'author/Board deck/write',
      'author/Handbook/write',
      'reader/Board deck/read',
      'reader/Handbook/write',
      'writer/Board deck/write',
      'writer/Handbook/write',
      'guest/Handbook/read',
      'admin/Board deck/write',
      'admin/Handbook/write',
    ]);
  });

  it('tells a reader of a published page nothing more than read', async () => {
    const { doc } = await createDoc(workspace.admin, {
      title: 'Launch brief',
      content: 'Public.',
      visibility: 'public',
    });
    const published = await getPublishedDoc(`launch-brief-${doc.publishToken ?? ''}`);
    expect(published?.access).toBe('read');
  });
});

describe('duplicateDoc', () => {
  it('copies the body and placement under a copy title owned by the duplicator', async () => {
    const { collection } = await createDocCollection(workspace.admin, { name: 'Playbooks' });
    const { doc: parent } = await createDoc(workspace.admin, {
      title: 'Parent',
      content: 'Top.',
      collectionId: collection.id,
    });
    const { doc: source } = await createDoc(workspace.admin, {
      title: 'Incident runbook',
      content: '# Incident runbook\n\nPage the on call.',
      parentId: parent.id,
    });
    const other = await addMember(workspace, 'member', { name: 'Mo Member' });

    const { doc: copy, actions } = await duplicateDoc(other.principal, source.id);

    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe('Incident runbook (copy)');
    expect(copy.content).toBe(source.content);
    expect(copy.collectionId).toBe(collection.id);
    expect(copy.parentId).toBe(parent.id);
    expect(copy.authorId).toBe(other.user.id);
    expect(copy.archivedAt).toBeNull();
    expect(actions[0]?.action).toBe('insert');
    expect(actions[0]?.scopes).toContain(scopes.doc(copy.id));

    const untouched = await getDoc(workspace.admin, source.id);
    expect(untouched.doc.title).toBe('Incident runbook');
    expect((await listDocs(workspace.admin)).map((row) => row.title)).toContain(
      'Incident runbook (copy)',
    );
  });

  it('never hands the copy the published link of the original', async () => {
    const { doc: source } = await createDoc(workspace.admin, {
      title: 'Launch brief',
      content: 'Read me.',
      visibility: 'public',
    });
    expect(source.publishToken).not.toBeNull();

    const { doc: copy } = await duplicateDoc(workspace.admin, source.id);

    expect(copy.publishToken).toBeNull();
    expect(copy.visibility).toBe('workspace');
    expect(await listPublicDocs()).toHaveLength(1);
  });

  it('drops a members link on duplicate the same way it drops a public one', async () => {
    const { doc: source } = await createDoc(workspace.admin, {
      title: 'Internal brief',
      content: 'Members only.',
      visibility: 'members',
    });
    expect(source.publishToken).not.toBeNull();

    const { doc: copy } = await duplicateDoc(workspace.admin, source.id);

    expect(copy.publishToken).toBeNull();
    expect(copy.visibility).toBe('workspace');
    expect(
      await resolvePublishedDoc(source.publishToken ?? '', workspace.admin.userId),
    ).toMatchObject({
      status: 'ok',
    });
  });

  it('lets someone with only read access take their own editable copy', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const reader = await addMember(workspace, 'member', { name: 'Rey Reader' });
    const { doc: source } = await createDoc(author.principal, {
      title: 'Private notes',
      content: 'Mine.',
      visibility: 'private',
    });
    await setDocAccess(author.principal, source.id, {
      grants: [{ subjectType: 'user', subjectId: reader.user.id, level: 'read' }],
    });
    await expect(updateDoc(reader.principal, source.id, { content: 'no' })).rejects.toMatchObject({
      code: 'forbidden',
    });

    const { doc: copy } = await duplicateDoc(reader.principal, source.id);

    expect(copy.authorId).toBe(reader.user.id);
    expect(copy.visibility).toBe('private');
    expect((await getDoc(reader.principal, copy.id)).access).toBe('write');
    await expect(getDoc(author.principal, copy.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a doc the caller cannot read, and refuses a contributor entirely', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const stranger = await addMember(workspace, 'member', { name: 'Stan Stranger' });
    const contributor = await addMember(workspace, 'contributor', { name: 'Cody' });
    const { doc: secret } = await createDoc(author.principal, {
      title: 'Secret',
      content: 'Hidden.',
      visibility: 'private',
    });
    const open = await newDoc('Open doc');

    await expect(duplicateDoc(stranger.principal, secret.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(duplicateDoc(contributor.principal, open.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('keeps a very long title inside the stored limit', async () => {
    const long = 'N'.repeat(DOC_TITLE_LIMIT);
    const { doc: source } = await createDoc(workspace.admin, { title: long, content: 'Body.' });

    const { doc: copy } = await duplicateDoc(workspace.admin, source.id);

    expect(copy.title.length).toBeLessThanOrEqual(DOC_TITLE_LIMIT);
    expect(copy.title.endsWith(' (copy)')).toBe(true);
  });

  it('takes a caller supplied title when one is given', async () => {
    const source = await newDoc('Weekly notes', 'Agenda.');

    const { doc: copy } = await duplicateDoc(workspace.admin, source.id, {
      title: 'Notes for the fourth',
    });

    expect(copy.title).toBe('Notes for the fourth');
    expect(copy.slug).toBe('notes-for-the-fourth');
  });
});

describe('a folder that goes away leaves its pages somewhere real', () => {
  it('lifts every page to the top level, renumbered and announced', async () => {
    const collection = await createDocCollection(workspace.admin, { name: 'Handbook' });
    const loose = await newDoc('Loose');
    const first = await createDoc(workspace.admin, {
      title: 'First',
      collectionId: collection.collection.id,
    });
    const nested = await createDoc(workspace.admin, {
      title: 'Nested',
      collectionId: collection.collection.id,
      parentId: first.doc.id,
    });

    const actions = await deleteDocCollection(workspace.admin, collection.collection.id);

    const lifted = (await getDoc(workspace.admin, first.doc.id)).doc;
    const child = (await getDoc(workspace.admin, nested.doc.id)).doc;
    expect(lifted.collectionId).toBeNull();
    expect(child.collectionId).toBeNull();
    expect(child.parentId).toBe(first.doc.id);
    expect(lifted.sortOrder).toBeGreaterThan(loose.sortOrder);
    expect(actions.filter((action) => action.modelId === first.doc.id)).toHaveLength(1);
    expect(actions.filter((action) => action.modelId === nested.doc.id)).toHaveLength(1);
  });
});

describe('deleting a page for good', () => {
  it('gives every orphan a place of its own after its new siblings', async () => {
    const parent = await newDoc('Parent');
    const neighbour = await newDoc('Neighbour');
    const one = await createDoc(workspace.admin, { title: 'One', parentId: parent.id });
    const two = await createDoc(workspace.admin, { title: 'Two', parentId: parent.id });

    const { promoted } = await deleteDoc(workspace.admin, parent.id);

    expect(promoted).toHaveLength(2);
    const orders = promoted.map((row) => row.sortOrder).sort((a, b) => a - b);
    expect(new Set(orders).size).toBe(2);
    expect(orders[0]).toBeGreaterThan(neighbour.sortOrder);
    expect(promoted.every((row) => row.parentId === null)).toBe(true);
    expect(promoted.map((row) => row.id).sort()).toEqual([one.doc.id, two.doc.id].sort());
  });
});

describe('duplicating a page twice', () => {
  it('gives each copy its own place instead of stacking them', async () => {
    const source = await newDoc('Source');
    await newDoc('After');

    const one = await duplicateDoc(workspace.admin, source.id);
    const two = await duplicateDoc(workspace.admin, source.id);

    expect(one.doc.sortOrder).not.toBe(two.doc.sortOrder);
    expect(one.doc.sortOrder).toBeGreaterThan(source.sortOrder);
    expect(two.doc.sortOrder).toBeGreaterThan(source.sortOrder);
  });
});

describe('nesting under a page you cannot read', () => {
  it('refuses, so a private page never gains a child from an outsider', async () => {
    const secret = await createDoc(workspace.admin, { title: 'Secret', visibility: 'private' });
    const outsider = await addMember(workspace, 'member', { name: 'Mo Member' });
    const { doc: mine } = await createDoc(outsider.principal, { title: 'Mine' });

    await expect(
      updateDoc(outsider.principal, mine.id, { parentId: secret.doc.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
