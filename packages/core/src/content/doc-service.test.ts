import { beforeEach, describe, expect, it } from 'bun:test';
import { scopes } from '@orbit/shared/events';
import { addMember, createWorkspace, resetDatabase, type Workspace } from '../test-support.ts';
import {
  archiveDoc,
  createDoc,
  createDocCollection,
  deleteDocCollection,
  getDoc,
  getPublishedDoc,
  listDocCollections,
  listDocs,
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
});
