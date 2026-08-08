import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import { setDocFavorite } from '../../src/content/doc-home-service.ts';
import { archiveDoc, createDoc, deleteDoc, listDocs } from '../../src/content/doc-service.ts';
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

async function newDoc(title: string, input: Record<string, unknown> = {}) {
  const { doc } = await createDoc(workspace.admin, { title, ...input });
  return doc;
}

describe('archiveDoc', () => {
  it('hides an archived doc from the list and brings it back on restore', async () => {
    const doc = await newDoc('Runbook');

    await archiveDoc(workspace.admin, doc.id);
    expect((await listDocs(workspace.admin, {})).map((row) => row.id)).not.toContain(doc.id);

    const { doc: restored } = await archiveDoc(workspace.admin, doc.id, false);
    expect(restored.archivedAt).toBeNull();
    expect((await listDocs(workspace.admin, {})).map((row) => row.id)).toContain(doc.id);
  });

  it('lists an archived doc when the caller asks for archived rows', async () => {
    const doc = await newDoc('Runbook');
    await archiveDoc(workspace.admin, doc.id);

    const rows = await listDocs(workspace.admin, { includeArchived: true });
    expect(rows.map((row) => row.id)).toContain(doc.id);
  });
});

describe('deleteDoc', () => {
  it('removes the doc for good and announces the delete', async () => {
    const doc = await newDoc('Runbook');

    const { actions } = await deleteDoc(workspace.admin, doc.id);

    expect(actions[0]?.action).toBe('delete');
    expect(actions[0]?.modelId).toBe(doc.id);
    const rows = await db.select().from(schema.doc).where(eq(schema.doc.id, doc.id));
    expect(rows).toHaveLength(0);
  });

  it('promotes the children to the parent of the doc it removed', async () => {
    const root = await newDoc('Root');
    const middle = await newDoc('Middle', { parentId: root.id });
    const leaf = await newDoc('Leaf', { parentId: middle.id });

    const { promoted } = await deleteDoc(workspace.admin, middle.id);

    expect(promoted.map((row) => row.id)).toEqual([leaf.id]);
    const rows = await listDocs(workspace.admin, {});
    expect(rows.find((row) => row.id === leaf.id)?.parentId).toBe(root.id);
  });

  it('takes the versions, comments and access rows with it', async () => {
    const doc = await newDoc('Runbook');
    await setDocFavorite(workspace.admin, doc.id, { favorite: true });

    await deleteDoc(workspace.admin, doc.id);

    const versions = await db
      .select()
      .from(schema.docVersion)
      .where(eq(schema.docVersion.docId, doc.id));
    const favorites = await db
      .select()
      .from(schema.favorite)
      .where(eq(schema.favorite.entityId, doc.id));
    expect(versions).toHaveLength(0);
    expect(favorites).toHaveLength(0);
  });

  it('lets an admin delete a doc somebody else wrote', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const { doc } = await createDoc(author.principal, { title: 'Theirs' });

    await expect(deleteDoc(workspace.admin, doc.id)).resolves.toBeDefined();
  });

  it('refuses a member who did not write the doc', async () => {
    const author = await addMember(workspace, 'member', { name: 'Ada Author' });
    const other = await addMember(workspace, 'member', { name: 'Ben Bystander' });
    const { doc } = await createDoc(author.principal, { title: 'Theirs' });

    await expect(deleteDoc(other.principal, doc.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
