import { beforeEach, describe, expect, it } from 'bun:test';
import { SORT_ORDER_STEP } from '@orbit/shared/constants';
import {
  createDoc,
  createDocCollection,
  listDocs,
  moveDoc,
  updateDoc,
} from '../../src/content/doc-service.ts';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function newCollection(name: string) {
  const { collection } = await createDocCollection(workspace.admin, { name });
  return collection;
}

async function newDoc(title: string, input: Record<string, unknown> = {}) {
  const { doc } = await createDoc(workspace.admin, { title, ...input });
  return doc;
}

describe('doc placement', () => {
  it('gives a nested doc the collection of its parent', async () => {
    const collection = await newCollection('Infrastructure');
    const parent = await newDoc('Parent', { collectionId: collection.id });
    const child = await newDoc('Child');

    const { doc } = await updateDoc(workspace.admin, child.id, { parentId: parent.id });

    expect(doc.parentId).toBe(parent.id);
    expect(doc.collectionId).toBe(collection.id);
  });

  it('ignores a collection sent alongside a parent, because the parent decides the home', async () => {
    const home = await newCollection('Home');
    const other = await newCollection('Other');
    const parent = await newDoc('Parent', { collectionId: home.id });
    const child = await newDoc('Child');

    const { doc } = await updateDoc(workspace.admin, child.id, {
      parentId: parent.id,
      collectionId: other.id,
    });

    expect(doc.collectionId).toBe(home.id);
  });

  it('carries the whole subtree into the new collection', async () => {
    const from = await newCollection('From');
    const to = await newCollection('To');
    const root = await newDoc('Root', { collectionId: from.id });
    const child = await newDoc('Child', { parentId: root.id });
    const grandchild = await newDoc('Grandchild', { parentId: child.id });

    await updateDoc(workspace.admin, root.id, { collectionId: to.id });

    const docs = await listDocs(workspace.admin, {});
    const homeOf = (id: string) => docs.find((entry) => entry.id === id)?.collectionId;
    expect(homeOf(root.id)).toBe(to.id);
    expect(homeOf(child.id)).toBe(to.id);
    expect(homeOf(grandchild.id)).toBe(to.id);
  });

  it('emits a delta for every descendant it carried along', async () => {
    const from = await newCollection('From');
    const to = await newCollection('To');
    const root = await newDoc('Root', { collectionId: from.id });
    const child = await newDoc('Child', { parentId: root.id });

    const { actions } = await updateDoc(workspace.admin, root.id, { collectionId: to.id });
    const ids = actions.map((action) => action.modelId);

    expect(ids).toContain(root.id);
    expect(ids).toContain(child.id);
  });

  it('detaches a doc from a parent that lives in another collection', async () => {
    const home = await newCollection('Home');
    const elsewhere = await newCollection('Elsewhere');
    const parent = await newDoc('Parent', { collectionId: home.id });
    const child = await newDoc('Child', { parentId: parent.id });

    const { doc } = await updateDoc(workspace.admin, child.id, { collectionId: elsewhere.id });

    expect(doc.collectionId).toBe(elsewhere.id);
    expect(doc.parentId).toBeNull();
  });

  it('keeps a doc under its parent when the collection does not change', async () => {
    const home = await newCollection('Home');
    const parent = await newDoc('Parent', { collectionId: home.id });
    const child = await newDoc('Child', { parentId: parent.id });

    const { doc } = await updateDoc(workspace.admin, child.id, { collectionId: home.id });

    expect(doc.parentId).toBe(parent.id);
  });

  it('refuses to nest a doc inside its own child', async () => {
    const root = await newDoc('Root');
    const child = await newDoc('Child', { parentId: root.id });

    await expect(updateDoc(workspace.admin, root.id, { parentId: child.id })).rejects.toMatchObject(
      { code: 'validation_failed' },
    );
  });

  it('refuses to nest a doc inside itself', async () => {
    const root = await newDoc('Root');

    await expect(updateDoc(workspace.admin, root.id, { parentId: root.id })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('doc ordering', () => {
  it('appends a new doc after its siblings', async () => {
    const first = await newDoc('First');
    const second = await newDoc('Second');

    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });

  it('orders the list by the manual order rather than by the last edit', async () => {
    const first = await newDoc('First');
    const second = await newDoc('Second');
    await updateDoc(workspace.admin, first.id, { content: 'edited last' });

    const docs = await listDocs(workspace.admin, {});
    const ids = docs.map((doc) => doc.id);

    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it('places a moved doc between the two it was dropped between', async () => {
    const first = await newDoc('First');
    const second = await newDoc('Second');
    const third = await newDoc('Third');

    const { doc } = await moveDoc(workspace.admin, third.id, {
      beforeId: first.id,
      afterId: second.id,
    });

    expect(doc.sortOrder).toBeGreaterThan(first.sortOrder);
    expect(doc.sortOrder).toBeLessThan(second.sortOrder);
  });

  it('rebalances the siblings when the gap between two neighbours collapses', async () => {
    const first = await newDoc('First');
    const second = await newDoc('Second');
    const mover = await newDoc('Mover');

    await moveDoc(workspace.admin, second.id, { beforeId: first.id, afterId: null });
    for (let round = 0; round < 60; round += 1) {
      await moveDoc(workspace.admin, mover.id, { beforeId: first.id, afterId: second.id });
    }

    const docs = await listDocs(workspace.admin, {});
    const orders = docs.map((doc) => doc.sortOrder);
    const gaps = orders.slice(1).map((order, index) => Math.abs(order - (orders[index] ?? 0)));

    expect(Math.min(...gaps)).toBeGreaterThan(0);
    expect(Math.max(...orders)).toBeGreaterThanOrEqual(SORT_ORDER_STEP);
  });

  it('moves a doc into a collection and takes its children with it', async () => {
    const collection = await newCollection('Specs');
    const root = await newDoc('Root');
    const child = await newDoc('Child', { parentId: root.id });

    const { doc, moved } = await moveDoc(workspace.admin, root.id, {
      collectionId: collection.id,
      beforeId: null,
      afterId: null,
    });

    expect(doc.collectionId).toBe(collection.id);
    expect(moved.map((row) => row.id)).toContain(child.id);
  });
});

describe('ordering anchors', () => {
  it('ignores a before anchor that lives in another folder', async () => {
    const here = await newCollection('Here');
    const elsewhere = await newCollection('Elsewhere');
    const first = await newDoc('First', { collectionId: here.id });
    const stranger = await newDoc('Stranger', { collectionId: elsewhere.id });
    const mover = await newDoc('Mover', { collectionId: here.id });

    const { doc } = await moveDoc(workspace.admin, mover.id, {
      collectionId: here.id,
      beforeId: stranger.id,
      afterId: null,
    });

    expect(doc.collectionId).toBe(here.id);
    expect(doc.sortOrder).toBeGreaterThan(first.sortOrder);
  });

  it('ignores an anchor that belongs to another workspace', async () => {
    const other = await createWorkspace('Other');
    const { doc: theirs } = await createDoc(other.admin, { title: 'Theirs' });
    const mine = await newDoc('Mine');

    const { doc } = await moveDoc(workspace.admin, mine.id, {
      beforeId: theirs.id,
      afterId: null,
    });

    expect(doc.organizationId).toBe(workspace.organizationId);
    expect(Number.isFinite(doc.sortOrder)).toBe(true);
  });
});
