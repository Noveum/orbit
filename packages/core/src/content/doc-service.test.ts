import { beforeEach, describe, expect, it } from 'bun:test';
import { scopes } from '@orbit/shared/events';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  archiveDoc,
  createDoc,
  createDocCollection,
  deleteDocCollection,
  docSlug,
  getDoc,
  getPublishedDoc,
  listDocCollections,
  listDocs,
  listDocVersions,
  listPublicDocs,
  publishedDocToken,
  restoreDocVersion,
  shareDoc,
  updateDoc,
  updateDocCollection,
} from './doc-service.ts';

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
